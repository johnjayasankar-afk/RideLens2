'use client';

/**
 * The trip, drawn to scale.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "37 MIN TRIP" WAS THREE LEGS WEARING ONE NUMBER                          │
 * │                                                                          │
 * │ A railroad publishes a run between two platforms. The card printed that  │
 * │ run as the trip, named the station the rider gets ON at, and said        │
 * │ nothing whatever about the station they get OFF at or the distance       │
 * │ either side. The Loop to O'Hare showed "Board at Chicago Union Station · │
 * │ 37 min trip" for a journey that is a twenty-two minute walk, a           │
 * │ thirty-seven minute train, and then two miles of nothing, because Metra  │
 * │ stops at Bensenville and the airport is not Bensenville.                 │
 * │                                                                          │
 * │ Drawn in proportion, that is obvious in one glance and impossible to     │
 * │ misread. The walk is a third of the bar. The gap is open rather than     │
 * │ filled, because the product does not know how the rider covers it and    │
 * │ will not imply that they walk.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import {
  isWalkable,
  journeySegments,
  type AccessLeg,
  type Journey,
  type JourneySegment,
} from '@/domain/journey';
import { milesLabel, minutesOf } from './format';

interface Props {
  journey: Journey;
  /** Where the rider asked to go, for the sentence about the part not covered. */
  destinationLabel?: string | null;
  compact?: boolean;
}

export function JourneyStrip({ journey, destinationLabel = null, compact = false }: Props) {
  const segments = journeySegments(journey);
  if (segments.length === 0) return null;

  return (
    <div
      data-testid="journey-strip"
      style={{ display: 'grid', gap: compact ? 'var(--sp-1)' : 'var(--sp-15)' }}
    >
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          gap: '3px',
          height: compact ? 7 : 10,
          // The bar is a measure, so it reads left to right at a fixed height
          // rather than growing with the text beneath it.
          alignItems: 'stretch',
        }}
      >
        {segments.map((seg, i) => (
          <span
            key={`${seg.kind}-${i}`}
            style={{
              flex: `${seg.share} 1 0`,
              minWidth: 0,
              borderRadius: 'var(--r-full)',
              ...fill(seg),
            }}
          />
        ))}
      </div>

      <p
        data-testid="journey-line"
        style={{
          margin: 0,
          fontSize: 'var(--t-sm)',
          lineHeight: 1.5,
          color: 'var(--text-2)',
        }}
      >
        {journeyLine(journey, destinationLabel)}
      </p>
    </div>
  );
}

/**
 * Filled for a leg the product can account for; open for the part it cannot.
 *
 * The gap is hatched rather than tinted so that it reads as absence even
 * without colour — the distinction it carries is too important to leave to hue
 * alone, and a rider with a colour vision deficiency needs it just as much.
 */
function fill(seg: JourneySegment): React.CSSProperties {
  if (seg.kind === 'GAP') {
    return {
      background: 'repeating-linear-gradient(135deg, var(--warn) 0 2px, transparent 2px 6px)',
      border: '1px solid color-mix(in srgb, var(--warn) 55%, transparent)',
    };
  }
  /*
   * A mid neutral rather than a border colour. The walk was first drawn in
   * --border-strong, which measured rgb(47,54,65) on the dark panel and was all
   * but invisible — an odd fate for the leg this whole component exists to
   * stop the product hiding. It reads as effort rather than vehicle without
   * disappearing into the background of either theme.
   */
  return {
    background: seg.kind === 'WALK' ? 'var(--text-3)' : 'var(--best)',
  };
}

/**
 * The same journey in a sentence, for anyone not reading the bar.
 *
 * Exported and tested on its own because it is the honest-claim surface: every
 * rule about what this product may assert lives in which words this function
 * chooses.
 */
export function journeyLine(journey: Journey, destinationLabel: string | null): string {
  const dest = placeName(destinationLabel);

  /*
   * "At least", never "about", for a leg the pedestrian router did not answer.
   *
   * A straight line is the shortest path that could exist between two points,
   * so a paced straight-line time is a floor rather than a guess — the real
   * walk is longer, and on the leg this was built for it is thirty per cent
   * longer. Saying "about" would let a reader round it either way; saying "at
   * least" tells them which way it moves, and quietly reports that the router
   * did not answer without making them read a status page to find out.
   */
  const walk = (leg: AccessLeg) =>
    `${leg.basis === 'ROUTED' ? '' : 'at least '}${minutesOf(leg.seconds)} min walk`;

  /*
   * Every leg speaks for itself, in travel order.
   *
   * Asking a single `gap` value which end was the problem worked until both
   * ends were, and then the near end vanished from the sentence: a Scarsdale
   * side street to Chelsea read as "49 min on board to Grand Central — which
   * leaves you 1.7 mi short", never mentioning that the boarding station was
   * two miles the other way.
   */
  const travel: string[] = [];
  /**
   * The stretch the fare does not cover, held back from the comma-joined list.
   *
   * It gets an em dash of its own because it is the most important thing in the
   * sentence, and a clause that matters most should not arrive looking like the
   * third item in a list.
   */
  let short = '';

  if (journey.board) {
    travel.push(
      isWalkable(journey.board)
        ? `${walk(journey.board)} to ${journey.board.station}`
        : `${journey.board.station} is ${milesLabel(journey.board.meters)} away, too far to walk`,
    );
  }
  if (journey.rideSeconds !== null) {
    const to = journey.alight ? ` to ${journey.alight.station}` : '';
    travel.push(`${minutesOf(journey.rideSeconds)} min on board${to}`);
  }
  if (journey.alight) {
    if (isWalkable(journey.alight)) {
      travel.push(`${walk(journey.alight)} at the other end`);
    } else {
      // A distance, not a time: the product does not know how it gets covered.
      short = ` — which leaves you ${milesLabel(journey.alight.meters)} short of ${dest}`;
    }
  }

  const head = travel.join(', ');
  if (short !== '') return `${head}${short}.`;
  if (journey.totalSeconds === null) return `${head}.`;
  const hedge = journey.estimated ? 'at least' : 'about';
  return `${head} — ${hedge} ${minutesOf(journey.totalSeconds)} min door to door.`;
}

/**
 * The specific half of a place label, for use inside a sentence.
 *
 * A geocoder returns the whole postal chain — "515 West 18th Street, New York,
 * New York" — which is right in a form field the rider is checking and wrong
 * in the middle of a clause about how far short a train stops. The first
 * segment is the one that identifies the place; a leading house number is
 * joined to the street that follows it rather than left stranded.
 */
export function placeName(label: string | null): string {
  const trimmed = label?.trim();
  if (!trimmed) return 'where you asked to go';
  const segments = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return 'where you asked to go';
  const head = /^\d+$/.test(segments[0] ?? '') ? segments.slice(0, 2).join(' ') : segments[0]!;
  return head;
}
