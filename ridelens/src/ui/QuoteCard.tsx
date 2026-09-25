'use client';

/**
 * One provider result.
 *
 * The card answers five questions at a glance, in this visual order:
 * WHO · HOW MUCH · HOW SOON · WHAT TYPE · HOW FRESH.
 *
 * Price is the dominant element and everything else is deliberately secondary.
 * Columns sit on a fixed grid so prices and ETAs align down the list —
 * misaligned numbers are what make comparison UIs feel cheap.
 *
 * The whole card is a button that opens the detail sheet; the Book control is a
 * separate button inside it, so a rider can inspect before committing.
 */
import { isInfoOnly } from '@/booking/resolver';
import { providerProfile } from '@/config/providers';
import { capacityFor } from '@/domain/capacity';
import { formatAge, formatExpiry } from '@/domain/freshness';
import { formatMoney } from '@/domain/money';
import type { NormalizedQuote } from '@/domain/quote';
import { isBookable } from '@/domain/ranking';
import { journeyOf } from '@/domain/journey';
import type { SavingsLine } from '@/domain/savings';
import { CATEGORY_LABELS } from '@/domain/taxonomy';
import { ProviderMark } from './ProviderMark';
import { formatEta, formatEtaAria, formatTripDuration, priceDisplay } from './format';
import { JourneyStrip } from './JourneyStrip';

export interface PriceDelta {
  direction: 'up' | 'down' | 'same';
  minor: number;
}

interface Props {
  quote: NormalizedQuote;
  savings: SavingsLine | null;
  now: number;
  hero?: boolean;
  headline?: string | null;
  delta?: PriceDelta | null;
  discrepancyNotice?: string | null;
  passengers?: number;
  /** Where the rider asked to go, for a fare that does not reach it. */
  destinationLabel?: string | null;
  onBook: (quote: NormalizedQuote) => void;
  onInspect: (quote: NormalizedQuote) => void;
}

export function QuoteCard({
  quote,
  savings,
  now,
  hero = false,
  headline = null,
  delta = null,
  discrepancyNotice = null,
  passengers = 1,
  destinationLabel = null,
  onBook,
  onInspect,
}: Props) {
  const profile = providerProfile(quote.provider);
  const price = priceDisplay(quote);
  const unavailable = quote.availability === 'UNAVAILABLE';
  const expired = quote.freshness === 'EXPIRED';
  // One rule, shared with the detail sheet. They disagreed once: the card
  // offered "How to ride" while the sheet said "Not bookable right now" for the
  // same quote, because one treated UNKNOWN availability as no and the other as
  // "not stated". The domain owns that reading now.
  const bookable = isBookable(quote);
  const expiry = formatExpiry(quote.expiresAt, now);
  const trip = formatTripDuration(quote.tripDurationSeconds);
  /*
   * Nobody is coming to fetch a train passenger, so "Pickup time unknown"
   * would be an admission of ignorance about something that does not exist.
   * The useful fact is which platform the trip starts from, and the source
   * already knows it.
   */
  /*
   * A mode with access legs gets the strip instead: "Board at X" named one end
   * of a three-leg journey and "37 min trip" was the middle leg wearing the
   * whole trip's clothes. A taxi has no legs and keeps the row below.
   */
  const journey = journeyOf(quote);
  /*
   * "Pickup time unknown" is an admission of ignorance, and it should only be
   * made where knowing was possible. A published rate card has no dispatch to
   * ask: you hail the cab, and the card already says so on its own button.
   * Printing it anyway made every taxi look like a provider that had failed to
   * answer.
   */
  const etaIsKnowable = quote.sourceMethod !== 'PUBLISHED_TARIFF';
  const fareClock = readFareClock(quote);
  const capacity = capacityFor(quote);
  const infoOnly = quote.bookingHandoff !== null && isInfoOnly(quote.bookingHandoff);

  return (
    <article
      className={`enter rl-card rl-press ${bookable ? 'rl-hover-lift' : ''}`}
      data-testid="quote-card"
      data-provider={quote.provider}
      data-category={quote.normalizedCategory}
      data-price-type={quote.priceType}
      data-bookable={bookable}
      data-hero={hero}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) auto',
        gap: hero ? 18 : 14,
        alignItems: 'center',
        padding: hero ? '17px 18px 17px 20px' : '13px 15px 13px 17px',
        background: 'var(--surface)',
        border: `1px solid ${hero ? 'var(--best-line)' : 'var(--border)'}`,
        borderRadius: 'var(--r-lg)',
        boxShadow: hero ? 'var(--e-3)' : 'var(--e-1)',
        opacity: unavailable || expired ? 0.6 : 1,
      }}
    >
      {/* Hairline brand rail — the only place a provider colour appears at size. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 9,
          bottom: 9,
          width: 3,
          borderRadius: '0 3px 3px 0',
          background: hero ? 'var(--best)' : profile.accent,
        }}
      />

      <div style={{ minWidth: 0 }}>
        {headline && (
          <p
            data-testid="card-headline"
            style={{
              margin: '0 0 7px',
              fontSize: 'var(--t-2xs)',
              fontWeight: 720,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--best)',
            }}
          >
            {headline}
          </p>
        )}

        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
        >
          <ProviderMark provider={quote.provider} size={hero ? 26 : 22} dimmed={!bookable} />
          <span style={{ fontSize: 'var(--t-base)', fontWeight: 650, letterSpacing: '-0.012em' }}>
            {profile.displayName}
          </span>
          <span style={{ fontSize: 'var(--t-sm)', color: 'var(--text-2)' }}>
            {quote.providerProductName}
          </span>
          <Chip>{CATEGORY_LABELS[quote.normalizedCategory]}</Chip>
          {passengers > 1 && <Chip>Seats {capacity.seats}</Chip>}
        </div>

        <div
          className="tnum"
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--sp-2)',
            marginTop: hero ? 9 : 6,
            flexWrap: 'wrap',
          }}
        >
          <span
            data-testid="quote-price"
            className="display"
            style={{
              fontSize: hero ? 'var(--t-4xl)' : 'var(--t-2xl)',
              lineHeight: 1.02,
            }}
          >
            {price.text}
          </span>
          {price.qualifier && (
            <span data-testid="price-qualifier" className="eyebrow">
              {price.qualifier}
            </span>
          )}
          {delta && delta.direction !== 'same' && (
            <span
              data-testid="price-delta"
              className="pulse"
              style={{
                fontSize: 'var(--t-sm)',
                fontWeight: 640,
                padding: '1px 5px',
                color: delta.direction === 'up' ? 'var(--danger)' : 'var(--best)',
              }}
              aria-label={`${delta.direction === 'up' ? 'Up' : 'Down'} ${(delta.minor / 100).toFixed(2)} since the last refresh`}
            >
              {delta.direction === 'up' ? '↑' : '↓'} {(delta.minor / 100).toFixed(2)}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            marginTop: 'var(--sp-15)',
            fontSize: 'var(--t-sm)',
            color: 'var(--text-2)',
            alignItems: 'center',
          }}
        >
          {/*
            Rendered only when there is something to say. An empty span still
            takes a flex gap, which pushed the freshness pill off the price's
            left edge on every rail card — measured at zero width and a real
            twelve-pixel indent.
          */}
          {quote.pickupEtaSeconds === null
            ? etaIsKnowable && <span className="tnum">Pickup time unknown</span>
            : journey === null && (
                <span className="tnum">
                  <strong style={{ fontWeight: 640, color: 'var(--text)' }}>
                    {formatEta(quote.pickupEtaSeconds)}
                  </strong>{' '}
                  pickup
                </span>
              )}
          {journey === null && trip && <span className="tnum">{trip}</span>}
          <FreshnessPill quote={quote} now={now} />
        </div>

        {journey && (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <JourneyStrip journey={journey} destinationLabel={destinationLabel} compact={!hero} />
          </div>
        )}

        {savings?.text && (
          <p
            data-testid="savings-line"
            style={{
              margin: '7px 0 0',
              fontSize: 'var(--t-base)',
              fontWeight: 560,
              color: savings.similar
                ? 'var(--text-2)'
                : (savings.deltaMinor ?? 0) < 0
                  ? 'var(--best)'
                  : 'var(--text-2)',
            }}
          >
            {savings.text}
          </p>
        )}

        {fareClock && (
          <p
            data-testid="fare-clock"
            className="tnum"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-15)',
              margin: '7px 0 0',
              fontSize: 'var(--t-xs)',
              fontWeight: 560,
              color: fareClock.rises ? 'var(--warn)' : 'var(--text-2)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: 'var(--r-full)',
                flex: '0 0 auto',
                background: fareClock.rises ? 'var(--warn)' : 'var(--best)',
              }}
            />
            {fareClock.text}
          </p>
        )}

        {expiry && (
          <p
            className="tnum"
            style={{ margin: '5px 0 0', fontSize: 'var(--t-xs)', color: 'var(--warn)' }}
          >
            {expiry}
          </p>
        )}

        {discrepancyNotice && (
          <p
            data-testid="discrepancy-notice"
            style={{
              margin: '7px 0 0',
              padding: '5px 8px',
              fontSize: 'var(--t-xs)',
              color: 'var(--warn)',
              background: 'var(--warn-soft)',
              border: '1px solid var(--warn-line)',
              borderRadius: 'var(--r-sm)',
            }}
          >
            {discrepancyNotice}
          </p>
        )}

        {unavailable && (
          <p style={{ margin: '7px 0 0', fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>
            No vehicles available right now.
          </p>
        )}
        {expired && !unavailable && (
          <p style={{ margin: '7px 0 0', fontSize: 'var(--t-sm)', color: 'var(--warn)' }}>
            This quote expired. Refresh for a current price.
          </p>
        )}

        <button
          type="button"
          data-testid="inspect-button"
          onClick={() => onInspect(quote)}
          className="rl-tap"
          style={{
            marginTop: 'var(--sp-2)',
            padding: 0,
            background: 'none',
            border: 'none',
            fontSize: 'var(--t-xs)',
            fontWeight: 560,
            color: 'var(--text-3)',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            textDecorationColor: 'var(--border-emphasis)',
          }}
        >
          {`Details · where this price came from`}
        </button>
      </div>

      <div className="rl-card-cta" style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          data-testid="book-button"
          disabled={!bookable}
          onClick={() => onBook(quote)}
          className="rl-press"
          style={{
            minHeight: 44,
            minWidth: hero ? 150 : 118,
            padding: '0 18px',
            fontSize: 'var(--t-base)',
            fontWeight: 630,
            fontFamily: 'var(--font-sans)',
            color: bookable ? (hero ? 'var(--on-inverse)' : 'var(--text)') : 'var(--text-4)',
            background: bookable
              ? hero
                ? 'var(--surface-inverse)'
                : 'var(--surface)'
              : 'var(--surface-sunken)',
            border: `1px solid ${
              bookable
                ? hero
                  ? 'var(--surface-inverse)'
                  : 'var(--border-emphasis)'
                : 'var(--border)'
            }`,
            borderRadius: 'var(--r-md)',
            cursor: bookable ? 'pointer' : 'not-allowed',
            boxShadow: bookable && hero ? 'var(--e-2)' : 'none',
          }}
        >
          {unavailable ? 'Unavailable' : infoOnly ? 'How to ride' : `Book ${profile.displayName}`}
        </button>
      </div>
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 'var(--t-2xs)',
        fontWeight: 620,
        letterSpacing: '0.045em',
        textTransform: 'uppercase',
        color: 'var(--text-3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xs)',
        padding: '1.5px 5px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function FreshnessPill({ quote, now }: { quote: NormalizedQuote; now: number }) {
  const isFixture = quote.source === 'demo_fixture';
  /*
   * A fare computed for next Tuesday is not live, however recently it was
   * computed. It is a projection of a rule, and the pulsing dot and the word
   * "live" both claim something about right now that is not true of it.
   */
  const scheduled = quote.scheduledFor !== null;
  const isLive = quote.freshness === 'LIVE' && !isFixture && !scheduled;
  const color = isFixture
    ? 'var(--text-4)'
    : scheduled
      ? 'var(--text-2)'
      : quote.freshness === 'LIVE'
        ? 'var(--live)'
        : quote.freshness === 'RECENT'
          ? 'var(--text-2)'
          : 'var(--stale)';

  const label = isFixture
    ? 'Fixture data'
    : scheduled
      ? 'Scheduled fare'
      : isLive
        ? `Live ${quote.priceType === 'UPFRONT_QUOTE' ? 'quote' : 'estimate'}`
        : formatAge(quote.receivedAt, now);

  return (
    <span
      data-testid="freshness"
      data-freshness={quote.freshness}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', color }}
    >
      <span
        aria-hidden
        className={isLive ? 'breathe' : undefined}
        style={{
          width: 6,
          height: 6,
          borderRadius: 'var(--r-full)',
          background: 'currentColor',
          opacity: isLive ? 1 : 0.5,
        }}
      />
      {label}
    </span>
  );
}

export { formatEtaAria };

/**
 * A tariff-priced quote can say what the same trip costs at the next rate
 * change, because the rate card says so. Nothing else in the product can, so
 * this reads only the keys the rate-card source writes and shows nothing at all
 * when they are absent.
 */
function readFareClock(quote: NormalizedQuote): { text: string; rises: boolean } | null {
  const kind = quote.metadata.fareClockKind;
  const at = quote.metadata.fareClockAtLabel;
  const delta = quote.metadata.fareClockDeltaMinor;
  if (typeof kind !== 'string' || typeof at !== 'string' || typeof delta !== 'number') return null;
  const amount = formatMoney(Math.abs(delta), quote.currency);
  return kind === 'RISES'
    ? { text: `Rises ${amount} at ${at}`, rises: true }
    : { text: `${amount} less from ${at}`, rises: false };
}
