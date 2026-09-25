'use client';

/**
 * The bottom line, said once, at the top.
 *
 * Only appears when the cheapest way to make the trip is not the one leading
 * the ride ranking — which is the case the rider would otherwise have to spot
 * for themselves, by scrolling past a card in the largest type on the screen.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "LESS" IS A CLAIM ABOUT TWO COMPARABLE THINGS                            │
 * │                                                                          │
 * │ This bar shipped saying "$52.93 less by regional rail" for a Metra fare  │
 * │ to Bensenville against a cab to the O'Hare terminal. Bensenville is 3.4  │
 * │ km from the airport. Those are not the same journey, and subtracting     │
 * │ their prices is the same category error as subtracting two currencies —  │
 * │ which this module already refused to do, two lines further down, while   │
 * │ doing this one.                                                          │
 * │                                                                          │
 * │ So the fare still leads, because $5.50 against $58.43 is worth knowing.  │
 * │ The word "less" does not, when the cheaper option stops short. It is      │
 * │ replaced by what is actually true: how far short, and of what.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The journey itself is drawn by the same component the card uses, so a leg
 * cannot be described one way here and another way twenty pixels below.
 */
import { providerProfile } from '@/config/providers';
import { formatMoney } from '@/domain/money';
import type { TripVerdict as Verdict } from '@/domain/verdict';
import { milesLabel, minutesOf } from './format';
import { JourneyStrip, placeName } from './JourneyStrip';
import { ProviderMark } from './ProviderMark';

interface Props {
  verdict: Verdict;
  /** Free-flow road time from the routing service, when it answered. */
  roadSeconds: number | null;
  /** Where the rider asked to go, for a fare that does not reach it. */
  destinationLabel: string | null;
  /** Scrolls the winning card into view and opens its detail. */
  onShowWinner: () => void;
}

export function TripVerdict({ verdict, roadSeconds, destinationLabel, onShowWinner }: Props) {
  const { winner, car, savingMinor, journey, arrives } = verdict;
  const winnerName = providerProfile(winner.provider).displayName;
  const carName = providerProfile(car.provider).displayName;

  return (
    <section
      data-testid="trip-verdict"
      aria-label="The cheapest way to make this trip"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--sp-3)',
        padding: 'var(--sp-3) var(--sp-4)',
        borderRadius: 'var(--r-lg)',
        // A fare that stops short is not the good news the green bar promises,
        // so it is tinted with the same caution the gap in the strip carries.
        background: arrives
          ? 'color-mix(in srgb, var(--best) 9%, var(--surface))'
          : 'color-mix(in srgb, var(--warn) 8%, var(--surface))',
        border: `1px solid color-mix(in srgb, ${arrives ? 'var(--best)' : 'var(--warn)'} 30%, transparent)`,
      }}
    >
      <span style={{ paddingTop: 'var(--sp-05)' }}>
        <ProviderMark provider={winner.provider} size={26} />
      </span>

      <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 'var(--sp-05)' }}>
        {/* The winning price gets real size. Stating the saving in a run of
            body text while the dearest option carried the largest number on the
            page meant a rider scanning by weight still read $58.43 first. */}
        <p
          className="tnum display"
          style={{
            margin: 0,
            fontSize: 'var(--t-2xl)',
            fontWeight: 680,
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
            color: arrives ? 'var(--best)' : 'var(--warn)',
          }}
        >
          {formatMoney(winner.priceMinMinor, winner.currency)}
        </p>

        <p
          data-testid="verdict-claim"
          style={{ margin: 0, fontSize: 'var(--t-base)', lineHeight: 1.4, color: 'var(--text)' }}
        >
          {arrives ? (
            <>
              by {winnerName.toLowerCase()} —{' '}
              <strong className="tnum" style={{ fontWeight: 660 }}>
                {formatMoney(savingMinor, winner.currency)} less
              </strong>{' '}
              than {aOrAn(carName)} at {formatMoney(car.priceMinMinor, car.currency)}.
            </>
          ) : (
            <>
              by {winnerName.toLowerCase()}, but it{' '}
              <strong style={{ fontWeight: 660 }}>
                stops {shortBy(verdict)} short of {placeName(destinationLabel)}
              </strong>
              . {capitalise(aOrAn(carName))} is{' '}
              <span className="tnum">{formatMoney(car.priceMinMinor, car.currency)}</span> and goes
              to the door.
            </>
          )}
        </p>

        {journey && (
          <div style={{ marginTop: 'var(--sp-15)' }}>
            <JourneyStrip journey={journey} destinationLabel={destinationLabel} />
          </div>
        )}

        {/*
         * The road figure is only ever set against a total that covers the same
         * journey. Where the fare stops short there is no such total, and the
         * comparison is withdrawn rather than made against a partial trip.
         */}
        {arrives && journey?.totalSeconds !== null && roadSeconds !== null && journey && (
          <p
            data-testid="verdict-road"
            style={{
              margin: 'var(--sp-05) 0 0',
              fontSize: 'var(--t-sm)',
              lineHeight: 1.5,
              color: 'var(--text-2)',
            }}
          >
            Against {minutesOf(roadSeconds)} min by road, door to door.
          </p>
        )}
      </div>

      <button
        type="button"
        data-testid="verdict-show"
        onClick={onShowWinner}
        className="rl-press rl-tap"
        style={{
          flex: '0 0 auto',
          alignSelf: 'center',
          padding: '0 var(--sp-3)',
          fontSize: 'var(--t-sm)',
          fontWeight: 620,
          fontFamily: 'var(--font-sans)',
          color: 'var(--text)',
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-md)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Show it
      </button>
    </section>
  );
}

/**
 * How far short the fare stops, in the unit the rider thinks in.
 *
 * Distance rather than time, because the product does not know how that last
 * stretch gets covered — on foot, by bus, by a second cab — and quoting a
 * walking time for it would pick one of those on the rider's behalf.
 */
export function shortBy(verdict: Verdict): string {
  const meters = verdict.journey?.alight?.meters ?? null;
  return meters === null ? 'some way' : milesLabel(meters);
}

/** "a licensed taxi", "an Uber" — the article the provider's own name takes. */
export function aOrAn(name: string): string {
  const lower = name.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
