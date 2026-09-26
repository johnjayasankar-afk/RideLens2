"use client";

/**
 * The trips you actually take.
 *
 * Quick fill offers six landmarks because a cold start has nothing better to
 * offer. Once the log has anything in it, it does: the airport run you price
 * twice a week beats a generic list of airports, and it is one tap rather
 * than two searches.
 *
 * Rows collapse by route, so a commute compared six times is one row that
 * says six — which is also the number that decides whether the results panel
 * has enough observations to say anything about this route at all.
 *
 * The footnote is not decoration. A list of somebody's regular movements is
 * exactly the kind of thing people assume has been uploaded, and it has not
 * been; saying so is cheaper than being asked.
 */

import type { PlaceValue } from "@/components/place-field";
import { coarseAgeLabel } from "@/lib/domain/freshness";
import { recentTrips, type TripRecord } from "@/lib/history/trip-log";

interface Props {
  records: readonly TripRecord[];
  onRun: (pickup: PlaceValue, destination: PlaceValue) => void;
  onForget: (routeKey: string) => void;
}

export function RecentTrips({ records, onRun, onForget }: Props) {
  const recents = recentTrips(records);
  if (recents.length === 0) return null;

  return (
    <div className="recent-trips" role="group" aria-label="Your recent trips">
      <div className="recent-trips-head">
        <span className="muted">Your trips</span>
        <span className="muted fine">On this device only</span>
      </div>
      <ul className="recent-trips-list">
        {recents.map((t) => (
          <li key={t.routeKey} className="recent-trip">
            <button
              type="button"
              className="recent-trip-run"
              onClick={() =>
                onRun(
                  {
                    lat: t.from.lat,
                    lng: t.from.lng,
                    formattedAddress: t.from.label,
                    label: t.from.label,
                  },
                  { lat: t.to.lat, lng: t.to.lng, formattedAddress: t.to.label, label: t.to.label },
                )
              }
            >
              <span className="recent-trip-route">
                {t.from.label} <span aria-hidden>→</span> {t.to.label}
              </span>
              <span className="recent-trip-meta muted">
                {t.times === 1 ? "once" : `${t.times} looks`} · {coarseAgeLabel(t.lastAt)}
              </span>
            </button>
            <button
              type="button"
              className="recent-trip-forget"
              onClick={() => onForget(t.routeKey)}
              aria-label={`Forget ${t.from.label} to ${t.to.label}`}
              title="Forget this trip"
            >
              <span aria-hidden>×</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
