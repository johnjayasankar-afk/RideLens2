'use client';

/**
 * When the rider is leaving.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A PRODUCT THAT REFUSES TO FORECAST CAN ANSWER THIS                   │
 * │                                                                          │
 * │ Every price RideLens shows without an agreement comes from a published   │
 * │ rule, and a rule prices any instant. "What will a cab to JFK cost at     │
 * │ 6:20 on Tuesday morning?" is arithmetic on a rate card — the same        │
 * │ arithmetic that prices a trip leaving now, with the same certainty.      │
 * │ It is the highest-stakes ride most people take and the one they plan     │
 * │ furthest ahead, and until now the app could only answer for this minute. │
 * │                                                                          │
 * │ Sources that cannot honestly project say so instead: a bike quote is     │
 * │ only honest because it names a station with a bike in it right now.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The control reads as a sentence rather than a form. Collapsed it is one
 * quiet line; opened it is a native datetime field, which costs no dependency
 * and gives a phone its own wheel picker for free.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface Props {
  /** ISO instant, or null for "leaving now". */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** How far ahead a fare may be projected, in days. */
  horizonDays: number;
}

export function DepartureTime({ value, onChange, horizonDays }: Props) {
  const [open, setOpen] = useState(false);
  const [bounds, setBounds] = useState<{ min: string; max: string } | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * The clock is read in the handler that opens the picker, not during render
   * and not in an effect. Reading it while rendering makes the field's own
   * limits drift every time the component happens to re-render — on a page
   * that ticks once a second, that is a real drift and not only a rule.
   */
  const openPicker = useCallback(() => {
    const now = Date.now();
    setBounds({
      min: toLocalInput(new Date(now).toISOString()),
      max: toLocalInput(new Date(now + horizonDays * 86_400_000).toISOString()),
    });
    setOpen(true);
  }, [horizonDays]);

  // Opening the picker should land the caret in it; a control that expands and
  // then makes you go find the field has not really opened.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const scheduled = value !== null;

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--sp-2)',
          minHeight: 20,
        }}
      >
        <span className="eyebrow" id={`${inputId}-label`}>
          When
        </span>
        {scheduled && (
          <button
            type="button"
            data-testid="departure-clear"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="rl-press"
            style={{
              padding: 0,
              background: 'none',
              border: 'none',
              fontSize: 'var(--t-xs)',
              color: 'var(--focus)',
              cursor: 'pointer',
            }}
          >
            Leave now instead
          </button>
        )}
      </div>

      {!open && (
        <button
          type="button"
          data-testid="departure-open"
          onClick={openPicker}
          className="rl-press"
          aria-describedby={`${inputId}-label`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--sp-2)',
            width: '100%',
            minHeight: 44,
            padding: '0 var(--sp-3)',
            fontSize: 'var(--t-base)',
            fontWeight: scheduled ? 620 : 520,
            fontFamily: 'var(--font-sans)',
            color: scheduled ? 'var(--text)' : 'var(--text-2)',
            textAlign: 'left',
            background: 'var(--surface)',
            border: `1px solid ${scheduled ? 'var(--border-strong)' : 'var(--border)'}`,
            borderRadius: 'var(--r-md)',
            cursor: 'pointer',
          }}
        >
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {scheduled ? formatDeparture(value) : 'Leaving now'}
          </span>
          <span aria-hidden style={{ color: 'var(--text-4)', fontSize: 'var(--t-xs)' }}>
            {scheduled ? 'Change' : 'Pick a time'}
          </span>
        </button>
      )}

      {open && (
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          <input
            ref={inputRef}
            id={inputId}
            data-testid="departure-input"
            type="datetime-local"
            aria-labelledby={`${inputId}-label`}
            value={value ? toLocalInput(value) : ''}
            min={bounds?.min}
            max={bounds?.max}
            onChange={(e) => {
              const raw = e.target.value;
              if (!raw) return void onChange(null);
              const parsed = new Date(raw);
              if (Number.isFinite(parsed.getTime())) onChange(parsed.toISOString());
            }}
            style={{
              width: '100%',
              minHeight: 44,
              padding: '0 var(--sp-3)',
              fontSize: 'var(--t-base)',
              fontFamily: 'var(--font-sans)',
              color: 'var(--text)',
              background: 'var(--surface)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-md)',
              colorScheme: 'light dark',
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {QUICK_PICKS.map((pick) => (
              <button
                key={pick.label}
                type="button"
                onClick={() => {
                  // A quick pick is a decision, not an adjustment: leaving the
                  // field and its chips open afterwards keeps a third of the
                  // rail occupied by a choice already made.
                  onChange(pick.at().toISOString());
                  setOpen(false);
                }}
                className="rl-press rl-tap"
                style={{
                  padding: '0 var(--sp-3)',
                  fontSize: 'var(--t-xs)',
                  fontWeight: 560,
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--text-2)',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-full)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {pick.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rl-press rl-tap"
              style={{
                marginLeft: 'auto',
                padding: '0 var(--sp-2)',
                fontSize: 'var(--t-xs)',
                color: 'var(--text-4)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/*
 * The departures people actually plan: an early flight, and the same trip on a
 * working morning. Both round to the hour, because nobody schedules a cab for
 * 6:47 — they schedule it for the flight and pad it.
 */
const QUICK_PICKS: Array<{ label: string; at: () => Date }> = [
  { label: 'Tomorrow 6am', at: () => atHour(1, 6) },
  { label: 'Tomorrow 8am', at: () => atHour(1, 8) },
  { label: 'Tomorrow 6pm', at: () => atHour(1, 18) },
];

function atHour(daysAhead: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** "Tue 8 Sep, 6:20 AM" — the day matters as much as the time when planning. */
export function formatDeparture(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'a chosen time';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The departure, said once in the reader's clock and — only when they differ —
 * again in the market's.
 *
 * `datetime-local` has no timezone: it means whatever the browser's wall clock
 * means, which for almost everybody is the city they are standing in. For the
 * traveller booking a New York cab from London it is not, and 6:20 in the
 * picker is 1:20 on the meter. Rather than guess which one they meant, the
 * result states both, because the second one is the clock the surcharge
 * windows are actually written against.
 *
 * `marketClock` is the market-local "HH:MM" the pricing engine stamped on the
 * instant it priced, so the comparison is against the truth rather than
 * against a timezone database this component would have to carry.
 */
export function describeDeparture(
  iso: string,
  marketClock: string | null,
  marketName: string | null,
): string {
  const reader = formatDeparture(iso);
  if (!marketClock) return reader;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return reader;
  const localClock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (localClock === marketClock) return reader;
  return marketName
    ? `${reader} — ${marketClock} in ${marketName}`
    : `${reader} — ${marketClock} there`;
}

/**
 * `datetime-local` speaks the browser's wall clock and has no timezone, so the
 * value has to be built from local parts rather than sliced off an ISO string —
 * `toISOString().slice(0, 16)` is UTC, and would silently shift the field by
 * the reader's offset every time the control re-rendered.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
