'use client';

/**
 * Ride detail — the transparency panel.
 *
 * This is where RideLens shows its working. A rider who wants to know *why*
 * one number beat another, where it came from, how firm it is, and what the
 * booking link will actually do can see all of it — including the candidates
 * reconciliation rejected.
 *
 * A comparison product that cannot explain itself is asking for trust it has
 * not earned.
 */
import { useMemo, useState } from 'react';
import { isInfoOnly } from '@/booking/resolver';
import { providerProfile } from '@/config/providers';
import { CAPACITY_DISCLOSURE, capacityFor } from '@/domain/capacity';
import type { FareBand } from '@/domain/fareclock';
import { formatAge, formatExpiry } from '@/domain/freshness';
import { formatMoney, formatRange, splitShareMinor } from '@/domain/money';
import type { NormalizedQuote, SourceDiscrepancy } from '@/domain/quote';
import { isBookable } from '@/domain/ranking';
import { CATEGORY_LABELS } from '@/domain/taxonomy';
import { relativeWidthBps } from '@/domain/uncertainty';
import { FareDay } from './FareDay';
import { ProviderMark } from './ProviderMark';
import { Sheet } from './Sheet';
import { isWalkable, journeyOf, type AccessLeg, type Journey } from '@/domain/journey';
import { formatEta, formatTripDuration, milesLabel, minutesOf, priceDisplay } from './format';
import { placeName } from './JourneyStrip';

/**
 * What each kind of number means.
 *
 * UPFRONT_QUOTE has two readings and they are not interchangeable. A provider
 * quoting its own binding fare honours it at booking. An authority publishing a
 * tariff is not honouring anything and there is no booking — the fare simply is
 * that, wherever you buy it. The tariff wording is picked at the call site.
 */
const PRICE_TYPE_EXPLAINER: Record<NormalizedQuote['priceType'], string> = {
  UPFRONT_QUOTE:
    'The provider states this as a binding fare for this trip and honours it at booking.',
  ESTIMATE: 'A single-point prediction. It can move before or after the ride.',
  ESTIMATE_RANGE:
    'A low/high band. Both ends are real prices; the midpoint is not a price and is never shown as one.',
  METERED_ESTIMATE:
    'A meter decides the final fare. This models a likely outcome and cannot account for traffic.',
  UNKNOWN: 'RideLens could not characterise this number, so it is never ranked as cheapest.',
};

const CONFIDENCE_EXPLAINER: Record<NormalizedQuote['confidenceClass'], string> = {
  HIGH: 'A firm commitment from the provider.',
  MEDIUM: 'A reasonable predictor of the final fare.',
  LOW: 'Wide or meter-dependent — treat as indicative only.',
  INDETERMINATE: 'Not enough information to judge.',
};

const SOURCE_METHOD_LABEL: Record<NormalizedQuote['sourceMethod'], string> = {
  AGGREGATOR_API: 'Licensed aggregation feed',
  DIRECT_PARTNER_API: 'Direct partner API',
  PERMITTED_PUBLIC_SURFACE: 'Permitted public surface',
  PUBLISHED_TARIFF: 'Official published rate card',
  OPEN_REALTIME_FEED: 'Open real-time feed (GBFS)',
  LOCAL_FIXTURE: 'Local fixture (not live)',
};

interface Props {
  quote: NormalizedQuote | null;
  candidates: NormalizedQuote[];
  discrepancy: SourceDiscrepancy | null;
  now: number;
  /** Where the rider asked to go, for a fare that does not reach it. */
  destinationLabel?: string | null;
  onClose: () => void;
  onBook: (quote: NormalizedQuote) => void;
}

/**
 * Past this, a rate card is old enough to say so. Cities change tariffs by
 * rulemaking and notify nobody downstream; Chicago's rose about a quarter in
 * one revision. Three months is short enough to catch that and long enough not
 * to cry wolf.
 */
const RATE_CARD_STALE_DAYS = 90;

export function RideDetailSheet({
  quote,
  candidates,
  discrepancy,
  now,
  onClose,
  onBook,
  destinationLabel = null,
}: Props) {
  const [people, setPeople] = useState(1);

  const rejected = useMemo(() => {
    if (!quote) return [];
    return candidates.filter(
      (c) =>
        c.id !== quote.id &&
        c.provider === quote.provider &&
        c.normalizedCategory === quote.normalizedCategory,
    );
  }, [candidates, quote]);

  /**
   * Everything below runs before the `!quote` guard, because hooks must be
   * called in the same order on every render and this component returns early
   * when there is no quote. Each one therefore tolerates a null quote.
   *
   * The day's fare bands arrive as JSON in the metadata bag, because the bag is
   * flat. Parsed defensively: a malformed string must cost the chart, never the
   * sheet.
   */
  const dayBands = useMemo<FareBand[] | null>(() => {
    const raw = quote?.metadata.fareDayBands;
    if (typeof raw !== 'string') return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      return parsed as FareBand[];
    } catch {
      return null;
    }
  }, [quote?.metadata.fareDayBands]);

  if (!quote) return null;

  const profile = providerProfile(quote.provider);
  const price = priceDisplay(quote);
  const capacity = capacityFor(quote);
  /*
   * A train is not a vehicle with a seat allocation, and it is not sent to
   * fetch anybody. Both of those rows read as errors on a rail card: "Pickup
   * in: ETA unknown" for something nobody dispatched, and a modelled seat
   * count for a ten-car train. The station is the fact that belongs there.
   */
  const journey = journeyOf(quote);
  const seatsApply = quote.normalizedCategory !== 'TRANSIT';
  const handoff = quote.bookingHandoff;
  const rangeWidth =
    quote.priceType === 'ESTIMATE_RANGE'
      ? relativeWidthBps(quote.priceMinMinor, quote.priceMaxMinor)
      : null;
  // Shared with the card — see the note there.
  const bookable = isBookable(quote);
  const infoOnly = handoff !== null && isInfoOnly(handoff);
  const share = splitShareMinor(quote.displayPriceMinor, people);

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${profile.displayName} ${quote.providerProductName}`}
      lead={<ProviderMark provider={quote.provider} size={30} />}
      testId="ride-detail"
      maxWidth={560}
      footer={
        <button
          type="button"
          disabled={!bookable}
          data-testid="detail-book"
          onClick={() => onBook(quote)}
          className="rl-press"
          style={{
            width: '100%',
            minHeight: 46,
            fontSize: 'var(--t-md)',
            fontWeight: 640,
            color: bookable ? 'var(--on-inverse)' : 'var(--text-4)',
            background: bookable ? 'var(--surface-inverse)' : 'var(--surface-sunken)',
            border: `1px solid ${bookable ? 'var(--surface-inverse)' : 'var(--border)'}`,
            borderRadius: 'var(--r-md)',
            cursor: bookable ? 'pointer' : 'not-allowed',
          }}
        >
          {!bookable
            ? 'Not bookable right now'
            : infoOnly
              ? 'How to ride'
              : `Book with ${profile.displayName}`}
        </button>
      }
    >
      {/* ── Headline price ────────────────────────────────────────────── */}
      <section
        style={{
          padding: '14px 15px',
          background: 'var(--surface-sunken)',
          borderRadius: 'var(--r-lg)',
          border: '1px solid var(--border)',
        }}
      >
        <div
          className="tnum"
          style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
        >
          <span className="display" style={{ fontSize: 'var(--t-3xl)', lineHeight: 1 }}>
            {price.text}
          </span>
          {price.qualifier && <span className="eyebrow">{price.qualifier}</span>}
        </div>
        <p
          style={{
            marginTop: 'var(--sp-2)',
            fontSize: 'var(--t-sm)',
            color: 'var(--text-2)',
            lineHeight: 1.5,
          }}
        >
          {quote.priceType === 'UPFRONT_QUOTE' && quote.sourceMethod === 'PUBLISHED_TARIFF'
            ? 'Fixed by the authority that publishes the fare, so it is this price whoever you buy it from. Nothing here is estimated.'
            : PRICE_TYPE_EXPLAINER[quote.priceType]}
        </p>
        {rangeWidth !== null && (
          <p style={{ marginTop: 'var(--sp-1)', fontSize: 'var(--t-xs)', color: 'var(--text-3)' }}>
            This band spans {(rangeWidth / 100).toFixed(1)}% of its midpoint, which is why it is
            ranked with uncertainty rather than by its low end.
          </p>
        )}
      </section>

      {/* ── Facts ─────────────────────────────────────────────────────── */}
      <Section title="This ride">
        <Rows
          rows={[
            ['Category', CATEGORY_LABELS[quote.normalizedCategory]],
            /*
             * A journey gets its legs itemised. The sheet used to report a
             * railroad's platform-to-platform run under "Trip time" beside a
             * single "Boarding at" row, which named one end of three legs and
             * called the middle one the trip.
             */
            ...(journey
              ? journeyRows(journey, destinationLabel)
              : ([
                  ['Pickup in', formatEta(quote.pickupEtaSeconds)],
                  [
                    'Trip time',
                    quote.tripDurationSeconds === null
                      ? 'Not supplied by the provider'
                      : `${formatTripDuration(quote.tripDurationSeconds)} (provider)`,
                  ],
                ] as Array<[string, string]>)),
            ...(seatsApply
              ? ([['Typical seats', `Up to ${capacity.seats} passengers`]] as Array<
                  [string, string]
                >)
              : []),
            [
              'Availability',
              // UNKNOWN is silence, not a no. A rate card knows the fare exactly
              // and nothing about where the cabs are; printing "No vehicles right
              // now" for that was simply false.
              quote.availability === 'AVAILABLE'
                ? 'Available'
                : quote.availability === 'UNAVAILABLE'
                  ? 'No vehicles right now'
                  : 'Not stated by this source',
            ],
          ]}
        />
        {seatsApply && <Footnote>{CAPACITY_DISCLOSURE}</Footnote>}
      </Section>

      {/* ── Split ─────────────────────────────────────────────────────── */}
      <Section title="Split the fare">
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}
        >
          <Stepper
            value={people}
            min={1}
            max={8}
            onChange={setPeople}
            label="People splitting the fare"
          />
          <div className="tnum" data-testid="split-amount">
            <span className="display" style={{ fontSize: 'var(--t-xl)' }}>
              {formatMoney(share, quote.currency)}
            </span>
            <span
              style={{
                marginLeft: 'var(--sp-15)',
                fontSize: 'var(--t-sm)',
                color: 'var(--text-3)',
              }}
            >
              each
            </span>
          </div>
        </div>
        <Footnote>
          Split in whole cents — the parts always add back to the total exactly.{' '}
          {quote.normalizedCategory === 'TRANSIT'
            ? 'The fare above already counts one ticket per passenger in the comparison.'
            : `Based on the observed ${price.qualifier?.toLowerCase() ?? 'price'}, not a final fare.`}
        </Footnote>
      </Section>

      {/* ── Provenance ────────────────────────────────────────────────── */}
      <Section title="Where this came from">
        <Rows
          rows={[
            [
              'Source',
              // A railroad publishes a fare table, not a rate card. Sources
              // that have their own word for the document say so.
              typeof quote.metadata.rateCardLabel === 'string'
                ? `Official ${String(quote.metadata.rateCardLabel).toLowerCase()}`
                : SOURCE_METHOD_LABEL[quote.sourceMethod],
            ],
            ['Source id', quote.source],
            ['Product id', quote.providerProductId],
            [
              'Pricing context',
              quote.accountContext === 'ACCOUNT_LINKED'
                ? 'Your linked provider account'
                : quote.accountContext === 'PUBLIC'
                  ? quote.sourceMethod === 'PUBLISHED_TARIFF'
                    ? 'Published public fare \u2014 the same for every rider'
                    : 'Public market price'
                  : 'Not stated by the source',
            ],
            [
              'Confidence',
              `${quote.confidenceClass} — ${CONFIDENCE_EXPLAINER[quote.confidenceClass]}`,
            ],
            ['Received', formatAge(quote.receivedAt, now)],
            [
              'Provider timestamp',
              quote.providerTimestamp
                ? new Date(quote.providerTimestamp).toLocaleTimeString()
                : 'Not supplied',
            ],
            ['Expiry', formatExpiry(quote.expiresAt, now) ?? 'No expiry supplied'],
            ['Freshness', quote.freshness],
          ]}
        />
        {typeof quote.metadata.surgeMultiplier === 'number' &&
          quote.metadata.surgeMultiplier > 1 && (
            <p
              style={{
                marginTop: 'var(--sp-2)',
                padding: '8px 10px',
                fontSize: 'var(--t-sm)',
                color: 'var(--warn)',
                background: 'var(--warn-soft)',
                border: '1px solid var(--warn-line)',
                borderRadius: 'var(--r-sm)',
              }}
            >
              Surge is active at {quote.metadata.surgeMultiplier}× — this price is elevated right
              now.
            </p>
          )}
      </Section>

      {/* ── When the fare changes ─────────────────────────────────────── */}
      {/* Shown whenever the day has more than one price, not only when a change
          is imminent: "the next change is eight hours away" is exactly when the
          whole-day view is the useful one. */}
      {(typeof quote.metadata.fareClockNote === 'string' || dayBands) && (
        <Section title="When this fare changes">
          {typeof quote.metadata.fareClockNote === 'string' && (
            <p
              data-testid="fare-clock-note"
              style={{
                margin: 0,
                fontSize: 'var(--t-sm)',
                lineHeight: 1.5,
                color: quote.metadata.fareClockKind === 'RISES' ? 'var(--warn)' : 'var(--text-2)',
              }}
            >
              {String(quote.metadata.fareClockNote)}
            </p>
          )}
          {dayBands && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <FareDay bands={dayBands} currency={quote.currency} />
            </div>
          )}
          <Footnote>
            This is the published tariff applied to the same measured route at a different clock
            time — not a prediction. No market-priced provider can be projected this way, so none
            is.
          </Footnote>
        </Section>
      )}

      {/* ── Rate card ─────────────────────────────────────────────────── */}
      {typeof quote.metadata.breakdown === 'string' && (
        <Section title="How this fare is built">
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 0 }}>
            {String(quote.metadata.breakdown)
              .split(' · ')
              .map((line, i) => {
                const idx = line.lastIndexOf(': ');
                const label = idx === -1 ? line : line.slice(0, idx);
                const amount = idx === -1 ? '' : line.slice(idx + 2);
                const uncertain = amount.endsWith('*');
                return (
                  <li
                    key={line}
                    className="tnum"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 'var(--sp-3)',
                      padding: '7px 0',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                      fontSize: 'var(--t-sm)',
                    }}
                  >
                    <span style={{ color: 'var(--text-2)' }}>
                      {label}
                      {uncertain && (
                        <span style={{ color: 'var(--text-4)' }}> · traffic-dependent</span>
                      )}
                    </span>
                    <span style={{ fontWeight: 620 }}>{amount.replace(/\*$/, '')}</span>
                  </li>
                );
              })}
          </ul>
          {typeof quote.metadata.explanation === 'string' && (
            <Footnote>{String(quote.metadata.explanation)}</Footnote>
          )}
          {typeof quote.metadata.rateCardUrl === 'string' && (
            <p style={{ marginTop: 'var(--sp-15)', fontSize: 'var(--t-xs)' }}>
              <a
                href={String(quote.metadata.rateCardUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="rl-tap"
                style={{ color: 'var(--focus)' }}
              >
                {typeof quote.metadata.rateCardLabel === 'string'
                  ? String(quote.metadata.rateCardLabel)
                  : 'Published rate card'}
              </a>
              <span style={{ color: 'var(--text-4)' }}>
                {' '}
                · checked {String(quote.metadata.rateCardVerifiedOn ?? 'recently')}
                {typeof quote.metadata.rateCardAgeDays === 'number' &&
                  quote.metadata.rateCardAgeDays > RATE_CARD_STALE_DAYS && (
                    <span style={{ color: 'var(--warn)', fontWeight: 560 }}>
                      {' '}
                      · {quote.metadata.rateCardAgeDays} days ago, worth re-checking
                    </span>
                  )}
              </span>
            </p>
          )}
        </Section>
      )}

      {/* ── Reconciliation ────────────────────────────────────────────── */}
      {rejected.length > 0 && (
        <Section title="Other sources for this ride">
          <p
            style={{
              fontSize: 'var(--t-sm)',
              color: 'var(--text-2)',
              marginBottom: 'var(--sp-2)',
              lineHeight: 1.5,
            }}
          >
            More than one source priced this product. RideLens shows the most authoritative one and
            keeps the rest here rather than hiding the disagreement. The two are never averaged — an
            average is a number no provider will honour.
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gap: 'var(--sp-15)',
            }}
          >
            {rejected.map((c) => (
              <li
                key={c.id}
                className="tnum"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  padding: '8px 10px',
                  fontSize: 'var(--t-sm)',
                  background: 'var(--surface-sunken)',
                  borderRadius: 'var(--r-sm)',
                }}
              >
                <span style={{ color: 'var(--text-2)' }}>
                  {c.source} · {c.priceType}
                </span>
                <span style={{ fontWeight: 600 }}>
                  {c.priceMinMinor === c.priceMaxMinor
                    ? formatMoney(c.displayPriceMinor, c.currency)
                    : formatRange(c.priceMinMinor, c.priceMaxMinor, c.currency)}
                </span>
              </li>
            ))}
          </ul>
          {discrepancy && (
            <p
              style={{
                marginTop: 'var(--sp-2)',
                padding: '8px 10px',
                fontSize: 'var(--t-sm)',
                color: discrepancy.severity === 'MATERIAL' ? 'var(--warn)' : 'var(--text-2)',
                background:
                  discrepancy.severity === 'MATERIAL'
                    ? 'var(--warn-soft)'
                    : 'var(--surface-sunken)',
                border: `1px solid ${discrepancy.severity === 'MATERIAL' ? 'var(--warn-line)' : 'var(--border)'}`,
                borderRadius: 'var(--r-sm)',
              }}
            >
              Sources disagree by {formatMoney(discrepancy.spreadMinor, discrepancy.currency)} (
              {(discrepancy.spreadBps / 100).toFixed(1)}%) — recorded as{' '}
              {discrepancy.severity.toLowerCase()}.
              {discrepancy.severity === 'MATERIAL' &&
                ' Confirm the fare in the provider app before booking.'}
            </p>
          )}
        </Section>
      )}

      {/* ── Handoff ───────────────────────────────────────────────────── */}
      <Section title="What happens when you book">
        {handoff ? (
          <>
            <Rows
              rows={[
                [
                  'Handoff',
                  handoff.kind === 'PREFILLED_DEEPLINK'
                    ? 'Deep link built by RideLens'
                    : handoff.kind === 'PARTIAL_DEEPLINK'
                      ? 'Link supplied by the quote source'
                      : handoff.kind === 'INFO_ONLY'
                        ? 'No link — arranged in person or in the operator app'
                        : 'Generic handoff',
                ],
                [
                  'Prefilled',
                  handoff.prefilledFields.length > 0
                    ? handoff.prefilledFields.join(', ')
                    : 'Nothing — enter the route in the provider app',
                ],
                [
                  'Prefill tested',
                  handoff.prefillVerification === 'VERIFIED'
                    ? 'Yes, confirmed in the provider app'
                    : handoff.prefillVerification === 'UNVERIFIED'
                      ? 'Not yet confirmed by a human'
                      : 'Not applicable',
                ],
                [
                  'Destination',
                  handoff.url === null
                    ? 'Nowhere to send you — this ride is arranged in person or in the operator\u2019s own app'
                    : new URL(handoff.url).hostname,
                ],
              ]}
            />
            {handoff.note && <Footnote>{handoff.note}</Footnote>}
          </>
        ) : (
          <p style={{ fontSize: 'var(--t-sm)', color: 'var(--text-2)' }}>
            RideLens has no verified booking route for this provider, so no button is offered.
            Inventing a URL would be worse than offering nothing.
          </p>
        )}
        <Footnote>
          {quote.sourceMethod === 'PUBLISHED_TARIFF'
            ? 'This fare is set by a public authority rather than by an app, so there is no account price that could quietly differ from it.'
            : `${profile.displayName} confirms the final fare in its own app, and your account there may show promotions or credits RideLens cannot see.`}
        </Footnote>
      </Section>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 'var(--sp-4)' }}>
      <h3 className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl style={{ display: 'grid', gap: 0 }}>
      {rows.map(([k, v], i) => (
        <div
          key={k}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(96px, 34%) 1fr',
            gap: 'var(--sp-3)',
            padding: '7px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            alignItems: 'baseline',
          }}
        >
          <dt style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>{k}</dt>
          <dd
            style={{
              fontSize: 'var(--t-sm)',
              fontWeight: 520,
              wordBreak: 'break-word',
              lineHeight: 1.45,
            }}
          >
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        marginTop: 'var(--sp-2)',
        fontSize: 'var(--t-xs)',
        lineHeight: 1.5,
        color: 'var(--text-3)',
      }}
    >
      {children}
    </p>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const btn = (dir: -1 | 1, glyph: string, disabled: boolean) => (
    <button
      type="button"
      className="rl-press"
      disabled={disabled}
      aria-label={dir === 1 ? `Increase ${label}` : `Decrease ${label}`}
      onClick={() => onChange(Math.min(max, Math.max(min, value + dir)))}
      style={{
        width: 34,
        height: 34,
        display: 'grid',
        placeItems: 'center',
        fontSize: 16,
        fontWeight: 600,
        color: disabled ? 'var(--text-4)' : 'var(--text)',
        background: 'var(--surface)',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {glyph}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
        background: 'var(--surface)',
      }}
    >
      {btn(-1, '−', value <= min)}
      <span
        className="tnum"
        aria-live="polite"
        style={{
          minWidth: 34,
          textAlign: 'center',
          fontSize: 'var(--t-base)',
          fontWeight: 620,
          borderLeft: '1px solid var(--border)',
          borderRight: '1px solid var(--border)',
          padding: '0 2px',
          lineHeight: '34px',
        }}
      >
        {value}
      </span>
      {btn(1, '+', value >= max)}
    </div>
  );
}

/**
 * The journey, leg by leg, in the sheet's own row vocabulary.
 *
 * Every claim this product makes about how long a trip takes is assembled
 * here or in the strip, and both read the same `Journey`. A row that cannot be
 * stated honestly is not printed: a total appears only when the fare completes
 * the trip, and the stretch it does not cover is reported as a distance rather
 * than dressed up as a final leg.
 */
function journeyRows(journey: Journey, destinationLabel: string | null): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const basis = (leg: AccessLeg) =>
    leg.basis === 'ROUTED'
      ? 'measured walking route'
      : 'straight line at 3 mph — the real walk is longer';

  if (journey.board) {
    rows.push([
      'Get on at',
      isWalkable(journey.board)
        ? `${journey.board.station} — ${minutesOf(journey.board.seconds)} min walk, ${milesLabel(journey.board.meters)} (${basis(journey.board)})`
        : `${journey.board.station} — ${milesLabel(journey.board.meters)} away, too far to walk`,
    ]);
  }
  if (journey.rideSeconds !== null) {
    rows.push(['On board', `${minutesOf(journey.rideSeconds)} min (published timetable)`]);
  }
  if (journey.alight) {
    rows.push([
      'Get off at',
      isWalkable(journey.alight)
        ? `${journey.alight.station} — ${minutesOf(journey.alight.seconds)} min walk, ${milesLabel(journey.alight.meters)} (${basis(journey.alight)})`
        : `${journey.alight.station} — ${milesLabel(journey.alight.meters)} from ${placeName(destinationLabel)}`,
    ]);
  }

  rows.push([
    'Door to door',
    journey.totalSeconds === null
      ? journey.gap === null
        ? 'Not supplied by the provider'
        : `Not stated — this fare does not cover the whole trip`
      : journey.estimated
        ? `At least ${minutesOf(journey.totalSeconds)} min, every leg counted`
        : `About ${minutesOf(journey.totalSeconds)} min, every leg counted`,
  ]);
  return rows;
}
