/**
 * Addresses, as a person would say them.
 *
 * A geocoder returns an administratively complete string, which is not the same
 * as a useful one. Nominatim gives back "Nasdaq MarketSite, 4, Times Square,
 * Manhattan Community Board 5, Manhattan, New York County, New York, 10036,
 * United States" for a point everybody calls Times Square. Printed in full it
 * wraps to five lines in a dialog, truncates mid-word in a field, and buries
 * the two words that identify the place.
 *
 * So the short form is built from the parts the geocoder already separates —
 * name, city, region — and the full string is kept for a `title` attribute and
 * for anywhere precision genuinely matters. Nothing is invented and nothing is
 * lost; it is the same location, said briefly.
 */
import type { CanonicalLocation } from './types';

/** Administrative noise nobody uses when naming a place out loud. */
const NOISE =
  /^(community board \d+|[a-z ]+ county|united states|usa|\d{5}(-\d{4})?|unnamed road)$/i;

/**
 * A short label: the place, then the city, then the region if it adds anything.
 *
 * Falls back through the full address when the structured parts are missing,
 * because a long label is still better than an empty one.
 */
export function shortAddress(loc: CanonicalLocation): string {
  const parts: string[] = [];

  const name = loc.name?.trim();
  if (name) parts.push(name);

  // Derive a street-level hint from the full address when there is no name:
  // the first one or two segments are the specific ones.
  if (parts.length === 0 && loc.formattedAddress) {
    const segments = loc.formattedAddress
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !NOISE.test(s));
    // "4, Times Square" reads better joined than as two entries.
    const head = segments.slice(0, /^\d+$/.test(segments[0] ?? '') ? 2 : 1);
    if (head.length > 0) parts.push(head.join(' '));
  }

  const city = loc.city?.trim();
  if (city && !parts.some((p) => p.toLowerCase().includes(city.toLowerCase()))) {
    parts.push(city);
  }

  const region = loc.region?.trim();
  if (
    region &&
    region.toLowerCase() !== city?.toLowerCase() &&
    !parts.some((p) => p.toLowerCase().includes(region.toLowerCase()))
  ) {
    parts.push(region);
  }

  if (parts.length === 0) return loc.formattedAddress || 'Selected point';
  return parts.join(', ');
}

/**
 * The same, capped for a tight space, with the full text expected to live in a
 * `title`. Cuts on a separator rather than mid-word.
 */
export function shortAddressCapped(loc: CanonicalLocation, maxChars = 48): string {
  const short = shortAddress(loc);
  if (short.length <= maxChars) return short;
  const cut = short.slice(0, maxChars);
  const lastSep = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${(lastSep > maxChars * 0.5 ? cut.slice(0, lastSep) : cut).trimEnd()}…`;
}
