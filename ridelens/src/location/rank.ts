/**
 * Suggestion relevance.
 *
 * Open geocoders rank by their own notion of prominence, which is not the same
 * as what a rider means. Typing "JFK Airport" and being offered "JFK Airport
 * Employee Parking" first is not merely untidy: it silently changes the
 * destination, and with it the fare — the regulated JFK flat fare applies to
 * the terminal, not to a car park two miles away.
 *
 * So this re-ranks rather than re-queries: a small, testable scoring pass over
 * what the geocoder already returned.
 */
import type { PlaceSuggestion } from './types';

const AIRPORT_WORDS = /\b(airport|international|terminal)\b/i;
/** Common IATA codes typed as shorthand. Matched as a whole word. */
const IATA = /\b(jfk|lga|ewr|ord|mdw|sfo|lax|dca|iad|bos|sea|atl|dfw|den|mia|phx|las)\b/i;

/** Words that mark a place as adjacent to the thing asked for, not the thing. */
const PERIPHERAL =
  /\b(parking|car\s*park|employee|staff|cargo|freight|rental|rent-?a-?car|hotel shuttle|long[- ]term|economy lot|garage|depot|holding)\b/i;

export function scoreSuggestion(query: string, s: PlaceSuggestion): number {
  const q = query.trim().toLowerCase();
  const primary = s.primaryText.toLowerCase();
  const full = `${s.primaryText} ${s.secondaryText}`.toLowerCase();
  let score = 0;

  // An exact or prefix match on the primary line is the strongest signal.
  if (primary === q) score += 100;
  else if (primary.startsWith(q)) score += 55;
  else if (primary.includes(q)) score += 30;
  else if (full.includes(q)) score += 12;

  const asksForAirport = AIRPORT_WORDS.test(q) || IATA.test(q);
  if (asksForAirport && s.kind === 'AIRPORT') score += 60;
  // The airport itself outranks everything inside its perimeter.
  if (asksForAirport && PERIPHERAL.test(full)) score -= 70;

  // A named venue beats a bare road when the query named something.
  if (s.kind === 'VENUE' || s.kind === 'LANDMARK') score += 8;
  if (s.kind === 'AIRPORT') score += 6;
  if (s.kind === 'OTHER') score -= 4;

  // Shorter names are usually the canonical entity rather than a sub-feature.
  score -= Math.min(12, Math.floor(s.primaryText.length / 12));

  return score;
}

/**
 * Stable sort by descending score. Ties keep the geocoder's own order, so this
 * only ever corrects a clear mistake rather than reshuffling good results.
 */
export function rankSuggestions(query: string, suggestions: PlaceSuggestion[]): PlaceSuggestion[] {
  return suggestions
    .map((s, i) => ({ s, i, score: scoreSuggestion(query, s) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}
