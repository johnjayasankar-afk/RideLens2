/**
 * Small geometry helpers for tariff zones.
 *
 * Regulated fares depend on *where* you are — a congestion surcharge below 96th
 * Street, a flat fare to an airport — so the rate-card engine needs to answer
 * "is this point inside that area?" without pulling in a GIS library.
 */

export interface Point {
  lat: number;
  lng: number;
}

/** [lng, lat] pairs, as GeoJSON orders them. */
export type Ring = ReadonlyArray<readonly [number, number]>;

export interface Circle {
  center: Point;
  radiusMeters: number;
}

export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function inBBox(p: Point, b: BBox): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

/**
 * Ray casting. Counts crossings of a horizontal ray to the east; odd means
 * inside. Handles the shared-vertex case by using a strict/non-strict pair on
 * the latitude comparison, which is the standard fix for double counting.
 */
export function inPolygon(p: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    const straddles = ay > p.lat !== by > p.lat;
    if (!straddles) continue;
    const x = ((bx - ax) * (p.lat - ay)) / (by - ay) + ax;
    if (p.lng < x) inside = !inside;
  }
  return inside;
}

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

export function inCircle(p: Point, c: Circle): boolean {
  return distanceMeters(p, c.center) <= c.radiusMeters;
}

/**
 * Local wall-clock parts for a market's own timezone.
 *
 * Surcharges are defined in local time — "4pm to 8pm on weekdays" means the
 * city's 4pm, not the server's. Using Intl rather than a date library keeps
 * this dependency-free and correct across DST.
 */
export interface LocalTime {
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
  year: number;
  /** 1 = January. */
  month: number;
  /** 1-31. */
  day: number;
}

export function localTimeIn(timeZone: string, at: Date = new Date()): LocalTime {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Intl renders midnight as "24" in some ICU versions; normalise it.
  const hour = Number(get('hour')) % 24;
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number(get('minute')) || 0,
    weekday: days[get('weekday')] ?? 0,
    year: Number(get('year')) || 1970,
    month: Number(get('month')) || 1,
    day: Number(get('day')) || 1,
  };
}

/** Minutes since local midnight — the unit surcharge windows are expressed in. */
export function hm(hour: number, minute = 0): number {
  return hour * 60 + minute;
}

export function minutesSinceMidnight(t: LocalTime): number {
  return t.hour * 60 + t.minute;
}

/**
 * True when `t` falls inside [startMin, endMin), wrapping past midnight.
 *
 * Minutes rather than hours because real rules are not hour-aligned: Chicago's
 * rush hour starts at 3:30pm, and rounding that to 4pm would undercharge every
 * fare in a half-hour window.
 */
export function inWindow(t: LocalTime, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  const now = minutesSinceMidnight(t);
  if (startMin < endMin) return now >= startMin && now < endMin;
  return now >= startMin || now < endMin;
}

export function isWeekday(t: LocalTime): boolean {
  return t.weekday >= 1 && t.weekday <= 5;
}

/**
 * Public holidays, for the rules that exempt them.
 *
 * New York's rush-hour surcharge is published as "4pm to 8pm weekdays,
 * **excluding holidays**", so a fare quoted at 5pm on Thanksgiving is $2.50 too
 * high without this. The set is the US federal calendar, which is the list
 * these municipal schedules mean when they say "holidays".
 *
 * Computed rather than tabulated so it does not expire. Federal holidays that
 * fall at a weekend are *observed* on an adjacent weekday, but a taxi rule
 * turning on the actual day is what a passenger experiences, and a weekend day
 * is already exempt from a weekdays-only surcharge either way.
 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, daysInMonth)).getUTCDay();
  return daysInMonth - ((last - weekday + 7) % 7);
}

export function isUsPublicHoliday(t: Pick<LocalTime, 'year' | 'month' | 'day'>): boolean {
  const { year: y, month: m, day: d } = t;
  const fixed: Array<[number, number]> = [
    [1, 1], // New Year's Day
    [6, 19], // Juneteenth
    [7, 4], // Independence Day
    [11, 11], // Veterans Day
    [12, 25], // Christmas Day
  ];
  if (fixed.some(([fm, fd]) => fm === m && fd === d)) return true;

  if (m === 1 && d === nthWeekdayOfMonth(y, 1, 1, 3)) return true; // MLK Day
  if (m === 2 && d === nthWeekdayOfMonth(y, 2, 1, 3)) return true; // Presidents' Day
  if (m === 5 && d === lastWeekdayOfMonth(y, 5, 1)) return true; // Memorial Day
  if (m === 9 && d === nthWeekdayOfMonth(y, 9, 1, 1)) return true; // Labor Day
  if (m === 10 && d === nthWeekdayOfMonth(y, 10, 1, 2)) return true; // Columbus Day
  if (m === 11 && d === nthWeekdayOfMonth(y, 11, 4, 4)) return true; // Thanksgiving
  return false;
}
