'use client';

/**
 * When to go.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE THING THIS PRODUCT KNOWS THAT NOTHING ELSE SHOWS YOU                 │
 * │                                                                          │
 * │ Every fare on this screen comes from a published rule on a clock, which  │
 * │ means the next 24 hours are knowable — not predicted, computed. New York │
 * │ adds $2.50 to a metered fare between 4pm and 8pm; the JFK flat fare goes │
 * │ up $5.00 in the same window; a Metro-North seat is $3.50 cheaper         │
 * │ off-peak. A rider who can shift an hour is being handed real money, and  │
 * │ until now the app buried that three scrolls into a modal.                │
 * │                                                                          │
 * │ One instrument, every priceable option on a shared axis that starts at   │
 * │ NOW and runs 24 hours forward, with a scrub line you can drag or arrow   │
 * │ through to ask "what if I go at eight?".                                 │
 * │                                                                          │
 * │ The vertical axis inside each row is that row's own price range, because │
 * │ a $10 train and a $75 taxi share no useful scale — and each row prints   │
 * │ its floor and ceiling so the shape can never be read as a bigger swing   │
 * │ than it is.                                                              │
 * │                                                                          │
 * │ It renders only for fares that genuinely move. A flat line across a day  │
 * │ would imply a variation the rider does not have.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { providerProfile } from '@/config/providers';
import {
  clockAfter,
  formatLead,
  planDeparture,
  priceAtOffset,
  MINUTES_PER_DAY,
  type DepartureAdvice,
  type DepartureOption,
} from '@/domain/departure';
import type { FareBand } from '@/domain/fareclock';
import { formatMoney } from '@/domain/money';
import { ProviderMark } from './ProviderMark';

interface Props {
  options: DepartureOption[];
  /**
   * True when the whole comparison is priced for a chosen departure rather
   * than now. The axis is anchored there either way — the sources sample from
   * the instant they priced — so what changes is only what the origin may be
   * called, and whether "in three hours" means anything. Measured from a
   * Tuesday-morning departure it does not.
   */
  scheduled?: boolean;
  /**
   * Adopt a time from the chart.
   *
   * Without this the timeline is a readout: you can see that eight in the
   * evening is five dollars cheaper and then have to go and type it. Given the
   * offset from the axis origin, the page re-prices the whole comparison for
   * that departure — which turns the chart into the control it looks like.
   */
  onPickTime?: (offsetMinutes: number) => void;
}

/** Row geometry. Short enough to stack several without the panel dominating. */
const TRACK_HEIGHT = 46;
/** The cheapest band still gets real presence; only the ceiling is full height. */
const MIN_FILL = 0.42;
/**
 * Ruler marks at round clock hours, placed at their true distance from now.
 *
 * "+6 hr" from 20:01 is 02:01, which is an accurate label nobody reads as a
 * time of day. Midnight and six in the morning are the marks a person actually
 * navigates by, so those are the ones drawn — at wherever they genuinely fall.
 */
const TICK_HOURS = [0, 6, 12, 18];

export function DeparturePlanner({ options, scheduled = false, onPickTime }: Props) {
  const [scrub, setScrub] = useState<number | null>(null);
  /*
   * Hovering previews a time; clicking pins it.
   *
   * Without the pin the feature was unusable with a mouse: leaving the track
   * clears the scrub, so travelling to the "Price 20:00" button destroyed the
   * very state the button acted on and it could never be clicked. A pinned
   * time also survives reading the numbers, which is the point of stopping
   * there in the first place. Keyboard moves pin too — an arrow press is a
   * deliberate act, not a passing glance.
   */
  const [pinned, setPinned] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const clearScrub = useCallback(() => {
    setScrub(null);
    setPinned(false);
  }, []);

  const varying = useMemo(() => options.filter((o) => o.bands.length > 1), [options]);
  const advice = useMemo(() => planDeparture(varying), [varying]);
  // The axis origin: "now" for a live comparison, the departure itself when the
  // rider has chosen one.
  const originLabel = scheduled ? 'departure' : 'now';
  // Every source samples the same 24 hours from the same instant, so any row's
  // first label is the market's clock right now.
  const nowLabel = varying[0]?.bands[0]?.fromLabel ?? null;

  const readOffset = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.width === 0) return;
    // Truncated, not rounded: one pixel of a 400px track is already a minute
    // and a half, so the distinction is invisible and this keeps the money
    // lint rule meaning what it says.
    const minute = Math.trunc(((clientX - box.left) / box.width) * MINUTES_PER_DAY);
    setScrub(Math.min(MINUTES_PER_DAY - 1, Math.max(0, minute)));
  }, []);

  const nudge = useCallback((by: number) => {
    setScrub((prev) => Math.min(MINUTES_PER_DAY - 1, Math.max(0, (prev ?? 0) + by)));
    setPinned(true);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 60 : 15;
      const moves: Record<string, () => void> = {
        ArrowRight: () => nudge(step),
        ArrowLeft: () => nudge(-step),
        PageUp: () => nudge(60),
        PageDown: () => nudge(-60),
        Home: () => {
          setScrub(0);
          setPinned(true);
        },
        End: () => {
          setScrub(MINUTES_PER_DAY - 1);
          setPinned(true);
        },
        Escape: clearScrub,
        // Enter and Space are how a focused control is activated, and this one
        // is a time picker whether or not it looks like a button.
        Enter: () => {
          if (scrub !== null) onPickTime?.(scrub);
        },
        ' ': () => {
          if (scrub !== null) onPickTime?.(scrub);
        },
      };
      const move = moves[e.key];
      if (!move) return;
      e.preventDefault();
      move();
    },
    [nudge, clearScrub, scrub, onPickTime],
  );

  if (varying.length === 0 || nowLabel === null) return null;

  const offset = scrub ?? 0;
  const scrubbing = scrub !== null;
  const scrubLabel = clockAfter(nowLabel, offset);
  const ticks = visibleTicks(nowLabel);
  const approximate = varying.some((o) => o.bands.some((b) => b.maxMinor !== b.minMinor));

  return (
    <section
      data-testid="departure-planner"
      aria-labelledby="departure-heading"
      style={{
        padding: 'var(--sp-4)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--e-1)',
        display: 'grid',
        gap: 'var(--sp-3)',
      }}
    >
      <header style={{ display: 'grid', gap: 'var(--sp-15)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--sp-3)',
            minHeight: 20,
          }}
        >
          <h2 className="eyebrow" id="departure-heading">
            When to go
          </h2>
          {scrubbing && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              {onPickTime && scrub > 0 && (
                <button
                  type="button"
                  data-testid="departure-adopt"
                  onClick={() => onPickTime(scrub)}
                  className="rl-press"
                  style={{
                    padding: '2px var(--sp-2)',
                    fontSize: 'var(--t-2xs)',
                    fontWeight: 660,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--on-inverse)',
                    background: 'var(--surface-inverse)',
                    border: '1px solid var(--surface-inverse)',
                    borderRadius: 'var(--r-full)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Leave {scrubLabel}
                </button>
              )}
              <button
                type="button"
                onClick={clearScrub}
                data-testid="departure-reset"
                className="rl-press"
                style={{
                  padding: '2px var(--sp-2)',
                  fontSize: 'var(--t-2xs)',
                  fontWeight: 660,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text-2)',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-full)',
                  cursor: 'pointer',
                }}
              >
                Back to {originLabel}
              </button>
            </span>
          )}
        </div>
        <p
          data-testid="departure-advice"
          style={{
            margin: 0,
            fontSize: 'var(--t-md)',
            lineHeight: 1.4,
            letterSpacing: '-0.011em',
            color: 'var(--text-2)',
            maxWidth: '48ch',
          }}
        >
          {advice ? (
            <Advice advice={advice} scheduled={scheduled} />
          ) : (
            <>This fare moves during the day.</>
          )}
        </p>
      </header>

      {/*
        The rows carry the interaction, and each track draws its own scrub
        line. An earlier draft used one overlay spanning the whole grid, which
        looked tidier and was wrong twice over: `grid-row: 1 / -1` counts lines
        of the *explicit* grid, so with implicit rows it silently collapsed to
        a strip over the first row — and it could not survive the chart moving
        to its own line on a narrow screen. Per-track lines share an x
        fraction, so they are pixel-identical anyway.
      */}
      <div
        ref={rowsRef}
        data-testid="departure-scrub"
        role="group"
        tabIndex={0}
        aria-label={`Fare by departure time over the 24 hours from ${nowLabel}. Arrow keys price another time, Enter to use it.`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          /*
           * Capture keeps a drag alive past the edge of the track, but it
           * throws outright if the pointer is already gone by the time the
           * handler runs — a finger lifted mid-dispatch, or a synthetic event.
           * An uncaught throw in a React event handler is a broken page, and
           * scrubbing works without capture; it just stops at the boundary.
           */
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Not fatal: the pointer simply is not ours to capture.
          }
          readOffset(e.clientX);
          // Pinned, so the reader can travel to the numbers — or to the button
          // that acts on them — without the time evaporating on the way.
          setPinned(true);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' || e.currentTarget.hasPointerCapture(e.pointerId)) {
            readOffset(e.clientX);
          }
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse' && !pinned) setScrub(null);
        }}
        onBlur={(e) => {
          // Focus moving to the adopt button is not leaving the control.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !pinned) setScrub(null);
        }}
        style={{ display: 'grid', gap: 'var(--sp-3)', touchAction: 'pan-y' }}
      >
        {varying.map((option, i) => (
          <div key={option.id} className="rl-plan-row">
            <div className="rl-plan-label" style={{ minWidth: 0 }}>
              <Label option={option} />
            </div>
            <div className="rl-plan-price">
              <Price option={option} offset={offset} />
            </div>
            <div
              className="rl-plan-track"
              // Every track has identical geometry, so measuring the first is
              // enough to turn a pointer position into a time.
              ref={i === 0 ? trackRef : undefined}
              style={{ position: 'relative', cursor: 'col-resize' }}
            >
              <Track option={option} ticks={ticks} />
              {scrubbing && (
                <span
                  aria-hidden
                  data-testid="scrub-rule"
                  style={{
                    position: 'absolute',
                    top: -2,
                    bottom: -2,
                    left: `${(offset / MINUTES_PER_DAY) * 100}%`,
                    width: 2,
                    marginLeft: -1,
                    background: 'var(--focus)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--surface) 70%, transparent)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
        ))}

        <div className="rl-plan-ruler" aria-hidden>
          <span className="rl-plan-gutter" />
          <div style={{ position: 'relative', height: 15 }}>
            <span
              style={{
                position: 'absolute',
                left: 0,
                fontSize: 'var(--t-2xs)',
                fontWeight: 660,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-2)',
                whiteSpace: 'nowrap',
              }}
            >
              {scheduled ? nowLabel : 'now'}
            </span>
            {ticks.map((t) => (
              <span
                key={t.offset}
                className="tnum"
                style={{
                  position: 'absolute',
                  left: `${(t.offset / MINUTES_PER_DAY) * 100}%`,
                  transform: 'translateX(-50%)',
                  fontSize: 'var(--t-2xs)',
                  color: 'var(--text-4)',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
              </span>
            ))}
          </div>
          <span className="rl-plan-gutter" />
        </div>
      </div>

      <p
        data-testid="departure-readout"
        aria-live="polite"
        style={{ margin: 0, fontSize: 'var(--t-xs)', color: 'var(--text-3)', lineHeight: 1.5 }}
      >
        {scrubbing
          ? `Leaving at ${scrubLabel}${offset >= MINUTES_PER_DAY - 60 ? ' tomorrow' : ''}: ${varying
              .map((o) => {
                const p = priceAtOffset(o.bands, offset);
                const base = priceAtOffset(o.bands, 0);
                if (!p) return `${providerProfile(o.provider).displayName} —`;
                // The sighted reader gets the difference from now as a chip
                // beside the price; this is the same fact, said aloud.
                const d = base ? p.minMinor - base.minMinor : 0;
                const change =
                  d === 0
                    ? ''
                    : d < 0
                      ? `, ${formatMoney(-d, o.currency)} less`
                      : `, ${formatMoney(d, o.currency)} more`;
                return `${providerProfile(o.provider).displayName} ${formatMoney(p.minMinor, o.currency)}${change}`;
              })
              .join(' · ')}`
          : `The published tariff applied to this same route at another clock time — not a prediction. Drag or arrow across the timeline to price a later departure.${approximate ? ' A “+” marks a fare carrying a charge we cannot pin down, so the figure is its floor.' : ''}`}
      </p>
    </section>
  );
}

function Advice({ advice, scheduled }: { advice: DepartureAdvice; scheduled: boolean }) {
  const name = providerProfile(advice.provider).displayName;
  // A clock time and the day it falls on are one fact; letting "tomorrow" wrap
  // onto its own line leaves it orphaned under the sentence.
  const when = (
    <span style={{ whiteSpace: 'nowrap' }}>
      {strong(advice.atLabel)}
      {advice.nextDay ? ' tomorrow' : ''}
    </span>
  );

  if (advice.kind === 'SAVE_BY_WAITING') {
    return (
      <>
        {strong(name)} drops to{' '}
        {strong(formatMoney(advice.thenMinor, advice.currency), 'var(--best)')} at {when} —{' '}
        {formatMoney(advice.deltaMinor, advice.currency)} less than now.
      </>
    );
  }
  if (advice.kind === 'HOLDS_UNTIL') {
    return (
      <>
        {strong(name)} is at its cheapest.{' '}
        {strong(formatMoney(advice.nowMinor, advice.currency), 'var(--best)')} holds until {when},
        then rises {formatMoney(advice.deltaMinor, advice.currency)}.
      </>
    );
  }
  return (
    <>
      {strong(name)} goes up{' '}
      {strong(formatMoney(advice.deltaMinor, advice.currency), 'var(--warn)')} at {when}
      {/* "in 3 hr" is measured from the axis origin. From a chosen departure
          that is three hours after the trip, which is not what it sounds like. */}
      {scheduled ? '' : `, ${formatLead(advice.inMinutes)}`}.
    </>
  );
}

function strong(children: React.ReactNode, color?: string) {
  return (
    <strong className="tnum" style={{ fontWeight: 680, color: color ?? 'var(--text)' }}>
      {children}
    </strong>
  );
}

function Label({ option }: { option: DepartureOption }) {
  const profile = providerProfile(option.provider);
  const lowest = Math.min(...option.bands.map((b) => b.minMinor));
  const highest = Math.max(...option.bands.map((b) => b.minMinor));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0 }}>
      <ProviderMark provider={option.provider} size={22} />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 'var(--t-sm)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {profile.displayName}
        </span>
        <span
          className="tnum"
          style={{
            display: 'block',
            fontSize: 'var(--t-2xs)',
            color: 'var(--text-4)',
            whiteSpace: 'nowrap',
          }}
        >
          {formatMoney(lowest, option.currency, { omitFractionWhenWhole: true })}–
          {formatMoney(highest, option.currency, { omitFractionWhenWhole: true })}
        </span>
      </span>
    </div>
  );
}

function Track({
  option,
  ticks,
}: {
  option: DepartureOption;
  ticks: Array<{ offset: number; label: string }>;
}) {
  const profile = providerProfile(option.provider);
  const lowest = Math.min(...option.bands.map((b) => b.minMinor));
  const highest = Math.max(...option.bands.map((b) => b.minMinor));
  const span = Math.max(1, highest - lowest);

  return (
    <svg
      viewBox={`0 0 ${MINUTES_PER_DAY} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${profile.displayName}: ${describe(option.bands, option.currency)}`}
      style={{
        display: 'block',
        width: '100%',
        height: TRACK_HEIGHT,
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-sunken)',
      }}
    >
      {ticks.map((t) => (
        <rect
          key={`grid-${t.offset}`}
          x={t.offset}
          y={0}
          width={2}
          height={100}
          fill="var(--border)"
        />
      ))}
      {option.bands.map((b) => {
        const t = (b.minMinor - lowest) / span;
        const h = (MIN_FILL + (1 - MIN_FILL) * t) * 100;
        const w = Math.max(2, b.toOffset - b.fromOffset);
        return (
          <g key={b.fromOffset}>
            <rect x={b.fromOffset} y={100 - h} width={w} height={h} fill={fill(t, 30)} />
            {/* A crisp cap on each step: the silhouette is what makes the row
                readable at 46px, and a flat wash loses it. */}
            <rect x={b.fromOffset} y={100 - h} width={w} height={6} fill={fill(t, 88)} />
          </g>
        );
      })}
    </svg>
  );
}

function Price({ option, offset }: { option: DepartureOption; offset: number }) {
  const lowest = Math.min(...option.bands.map((b) => b.minMinor));
  const at = priceAtOffset(option.bands, offset);
  const now = priceAtOffset(option.bands, 0);
  const cheapest = at !== null && at.minMinor === lowest;
  /*
   * The question the scrub is asking is "am I better off?", and answering it
   * from the price alone means holding the original number in your head while
   * you drag. The difference from now is the answer, so it is shown.
   */
  const delta = at && now ? at.minMinor - now.minMinor : 0;

  return (
    <div
      data-testid="departure-price"
      style={{
        width: '100%',
        display: 'grid',
        justifyItems: 'end',
        gap: 'var(--sp-05)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className="tnum"
        style={{
          fontSize: 'var(--t-base)',
          fontWeight: 660,
          color: cheapest ? 'var(--best)' : 'var(--text)',
        }}
      >
        {at ? formatMoney(at.minMinor, option.currency) : '—'}
        {at && at.maxMinor !== at.minMinor ? '+' : ''}
      </span>
      {delta !== 0 && (
        <span
          className="tnum"
          data-testid="departure-delta"
          style={{
            fontSize: 'var(--t-2xs)',
            fontWeight: 640,
            color: delta < 0 ? 'var(--best)' : 'var(--warn)',
          }}
        >
          {delta < 0 ? '−' : '+'}
          {formatMoney(Math.abs(delta), option.currency)}
        </span>
      )}
    </div>
  );
}

/*
 * Cheapest green through dearest amber. Mixed against `transparent` rather than
 * reaching for the pre-mixed --*-soft tokens: those are tuned to sit behind
 * body text and in dark mode they land so close to the surface that the whole
 * chart reads as smudges — which is exactly what the first draft of this did.
 */
function fill(t: number, strength: number): string {
  return `color-mix(in srgb, ${t < 0.5 ? 'var(--best)' : 'var(--warn)'} ${strength}%, transparent)`;
}

/**
 * The round clock hours that fall inside the next 24, and how far away each is.
 *
 * Every six-hour mark occurs exactly once in any 24-hour window, so this is
 * always four marks — spread unevenly, because that is where they actually are.
 * A mark within half an hour of now is dropped: it would collide with the NOW
 * label and say the same thing.
 */
function tickMarks(nowLabel: string): Array<{ offset: number; label: string }> {
  const [h = 0, m = 0] = nowLabel.split(':').map(Number);
  const nowClock = h * 60 + m;
  return TICK_HOURS.map((hour) => ({
    offset: (hour * 60 - nowClock + MINUTES_PER_DAY) % MINUTES_PER_DAY,
    label: `${String(hour).padStart(2, '0')}:00`,
  }));
}

/**
 * Ticks too close to either end are dropped: they would sit under the NOW
 * label, and they say the same thing it does. Two and a half hours is about
 * where the two stop touching on a phone-width ruler.
 */
const TICK_CLEARANCE_MINUTES = 150;

function visibleTicks(nowLabel: string): Array<{ offset: number; label: string }> {
  return tickMarks(nowLabel).filter(
    (t) => t.offset > TICK_CLEARANCE_MINUTES && t.offset < MINUTES_PER_DAY - TICK_CLEARANCE_MINUTES,
  );
}

function describe(bands: readonly FareBand[], currency: string): string {
  return bands
    .map((b) => `${b.fromLabel} to ${b.toLabel}, ${formatMoney(b.minMinor, currency)}`)
    .join('; ');
}
