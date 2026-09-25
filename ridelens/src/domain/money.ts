/**
 * Money in RideLens is ALWAYS an integer count of a currency's minor units
 * (cents for USD, pence for GBP, whole yen for JPY). No float ever holds a
 * price. Parsing happens once, at the source-adapter boundary; everything
 * downstream — ranking, savings, display — operates on integers.
 */

/** ISO-4217 codes whose minor unit is not 10^-2. */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

export const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'MXN'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isIso4217(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/** Currencies we are confident we render correctly. See FAILURE_MODES.md §"Unexpected currency". */
export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

export function minorUnitExponent(currency: string): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

export class MoneyParseError extends Error {
  constructor(
    message: string,
    readonly input: unknown,
  ) {
    super(message);
    this.name = 'MoneyParseError';
  }
}

/**
 * Convert a provider's decimal major-unit amount to integer minor units.
 *
 * Providers hand us numbers like 23.84 or strings like "23.84" / "$23.84".
 * IEEE-754 makes `23.84 * 100 === 2383.9999999999995`, so we parse the decimal
 * representation textually rather than multiplying the float.
 */
export function majorToMinor(amount: number | string, currency: string): number {
  const exp = minorUnitExponent(currency);

  let text: string;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) throw new MoneyParseError('Non-finite amount', amount);
    // toFixed(exp + 4) keeps enough digits that we never lose a real minor unit,
    // while normalising away float representation noise.
    text = amount.toFixed(exp + 4);
  } else {
    text = amount.trim().replace(/[^0-9.\-]/g, '');
    if (text === '' || text === '-' || !/^-?\d*\.?\d*$/.test(text)) {
      throw new MoneyParseError('Unparseable amount', amount);
    }
  }

  const negative = text.startsWith('-');
  if (negative) text = text.slice(1);

  const dot = text.indexOf('.');
  const intPart = dot === -1 ? text : text.slice(0, dot);
  const fracPart = dot === -1 ? '' : text.slice(dot + 1);

  const paddedFrac = (fracPart + '0'.repeat(exp + 1)).slice(0, exp + 1);
  const kept = paddedFrac.slice(0, exp);
  const nextDigit = paddedFrac.charCodeAt(exp) - 48;

  const base = Number((intPart === '' ? '0' : intPart) + kept);
  if (!Number.isSafeInteger(base)) throw new MoneyParseError('Amount out of range', amount);

  // Half-up on the first dropped digit.
  const rounded = nextDigit >= 5 ? base + 1 : base;
  return negative ? -rounded : rounded;
}

/** Integer midpoint of a price range, biased low so we never overstate a fare. */
export function midpointMinor(lowMinor: number, highMinor: number): number {
  const sum = lowMinor + highMinor;
  // Math.floor on integers is exact — this is not currency float arithmetic.
  return Math.floor(sum / 2);
}

export function formatMoney(
  minor: number,
  currency: string,
  opts: { locale?: string; omitFractionWhenWhole?: boolean } = {},
): string {
  const exp = minorUnitExponent(currency);
  const locale = opts.locale ?? 'en-US';
  const major = minor / 10 ** exp;
  const whole = exp > 0 && minor % 10 ** exp === 0;
  const digits = opts.omitFractionWhenWhole && whole ? 0 : exp;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    // Unknown ISO code — degrade to an explicit, unambiguous rendering.
    return `${major.toFixed(exp)} ${currency}`;
  }
}

/**
 * Render a range the way a person reads it: "$27–34" when both ends are whole,
 * "$27.50–34.10" otherwise. We never collapse a range to a single number.
 */
export function formatRange(
  lowMinor: number,
  highMinor: number,
  currency: string,
  locale = 'en-US',
): string {
  const exp = minorUnitExponent(currency);
  const bothWhole = exp > 0 && lowMinor % 10 ** exp === 0 && highMinor % 10 ** exp === 0;
  const low = formatMoney(lowMinor, currency, { locale, omitFractionWhenWhole: bothWhole });
  const highNum = highMinor / 10 ** exp;
  const highText = bothWhole ? String(Math.trunc(highNum)) : highNum.toFixed(exp);
  return `${low}–${highText}`;
}

/** Signed difference for savings copy. Always integer minor units. */
export function deltaMinor(candidateMinor: number, baselineMinor: number): number {
  return candidateMinor - baselineMinor;
}

/**
 * Split a fare between people, exactly.
 *
 * The naive `total / n` rounded per person either loses or invents money: a
 * $28.46 fare between 3 is 9.4866… each, and three lots of $9.49 is $28.47.
 * We divide in integer minor units and hand the remainder to the first payers,
 * so the parts always sum to the total to the cent.
 */
export function splitMinor(totalMinor: number, people: number): number[] {
  if (!Number.isInteger(people) || people < 1) throw new RangeError('people must be >= 1');
  const base = Math.trunc(totalMinor / people);
  const remainder = totalMinor - base * people;
  return Array.from({ length: people }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** The largest share, which is what "each" should quote so nobody under-pays. */
export function splitShareMinor(totalMinor: number, people: number): number {
  const parts = splitMinor(totalMinor, people);
  return parts[0] ?? totalMinor;
}
