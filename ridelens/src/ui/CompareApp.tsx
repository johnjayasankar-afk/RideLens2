'use client';

/**
 * The RideLens application shell.
 *
 * Desktop: route form and map in a sticky left rail, results in the main pane.
 * Mobile: the route collapses above a sticky toolbar, results below.
 *
 * This component owns coordination only. Every judgement about money,
 * semantics or ranking lives in `src/domain`, so the UI cannot accidentally
 * invent a price.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { providerProfile } from '@/config/providers';
import { filterByParty } from '@/domain/capacity';
import { refreshQuoteFreshness } from '@/domain/freshness';
import type { NormalizedQuote, ProviderId } from '@/domain/quote';
import {
  applyFilter,
  BEST_VALUE_EXPLANATION,
  fastestPickup,
  rankQuotes,
  type RankMode,
  type ResultFilter,
} from '@/domain/ranking';
import { discrepancyNotice } from '@/domain/reconcile';
import { tripVerdict } from '@/domain/verdict';
import { SCHEDULE_HORIZON_DAYS } from '@/app/api/_lib/schemas';
import type { DepartureOption } from '@/domain/departure';
import type { ExampleTrip } from '@/domain/examples';
import { OTHER_MODES } from '@/domain/taxonomy';
import { savingsFor } from '@/domain/savings';
import { compareWithUncertainty, headlineFor, intervalOf } from '@/domain/uncertainty';
import type { RouteGeometry } from '@/location/routing';
import { shortAddress } from '@/location/display';
import { MAX_BIKE_METERS } from '@/domain/bike';
import { buildTripSummary } from '@/domain/summary';
import dynamic from 'next/dynamic';
import { BrandLockup } from './Brand';
import { DeparturePlanner } from './DeparturePlanner';
import { DepartureTime, describeDeparture } from './DepartureTime';
import { EmptyState } from './EmptyState';
import { FilterBar } from './FilterBar';
import { HandoffDialog } from './HandoffDialog';
import { PartySize } from './PartySize';
import { PlaceInput, type PlaceValue, type QuickPick } from './PlaceInput';
import { PriceHistory } from './PriceHistory';
import { QuoteCard, type PriceDelta } from './QuoteCard';
import { RideDetailSheet } from './RideDetailSheet';
import type { MapStation } from './RouteMap';

/**
 * The map is loaded when it is needed, not when the page is.
 *
 * It brings MapLibre and a 69KB stylesheet with it, and it does not exist until
 * a comparison has run — so putting it on the critical path charges every
 * visitor for something most of them have not asked for yet. `ssr: false`
 * because MapLibre needs a real canvas, and the placeholder holds the exact
 * height so nothing below it jumps when the map arrives.
 */
const RouteMap = dynamic(() => import('./RouteMap').then((m) => m.RouteMap), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="skeleton"
      style={{ height: 248, borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}
    />
  ),
});
import { SessionToolbar } from './SessionToolbar';
import { ShortcutHelpSheet, useShortcuts } from './ShortcutHelp';
import { SkeletonList } from './SkeletonList';
import { SourceStatus } from './SourceStatus';
import { TripVerdict } from './TripVerdict';
import { formatEta } from './format';
import { useCompareSession } from './useCompareSession';
import { useLiveRefresh } from './useLiveRefresh';
import { useOnline } from './useOnline';
import { usePlaces, type SavedSlot } from './usePlaces';
import { useRouteDraft } from './useRouteDraft';

interface Props {
  sourceProviders: Record<string, ProviderId[]>;
  liveDataAvailable: boolean;
  coveredMarkets: string[];
  bikeSystems: string[];
  railSystems: string[];
  fixtureBacked: boolean;
  blockerSummary: string | null;
  /** Set when the page was opened from a share link. */
  initialRoute?: { pickup: PlaceValue; destination: PlaceValue } | null;
}

export function CompareApp({
  sourceProviders,
  liveDataAvailable,
  coveredMarkets,
  bikeSystems,
  railSystems,
  fixtureBacked,
  blockerSummary,
  initialRoute = null,
}: Props) {
  const { state, now, run, reset, busy } = useCompareSession();
  const places = usePlaces();
  const online = useOnline();

  /**
   * The form, restored across a page reload within this tab.
   *
   * Derived during render rather than copied into state by an effect: the draft
   * is an external store, and seeding state from one in an effect means a
   * second render pass and a frame of empty fields. `undefined` means "the
   * rider has not touched this yet, so show whatever we remember"; once they
   * pick or clear a place the override wins, including when they clear it to
   * null.
   *
   * A share link always beats a draft — someone opening one is asking for that
   * route, not for whatever they were looking at before.
   */
  const draft = useRouteDraft();
  const [pickupEdit, setPickupEdit] = useState<PlaceValue | null | undefined>(undefined);
  const [destinationEdit, setDestinationEdit] = useState<PlaceValue | null | undefined>(undefined);
  const pickup =
    pickupEdit !== undefined ? pickupEdit : (initialRoute?.pickup ?? draft.restored.pickup);
  const destination =
    destinationEdit !== undefined
      ? destinationEdit
      : (initialRoute?.destination ?? draft.restored.destination);

  /*
   * Emptying both fields is an unambiguous "start over", so the results go with
   * them — and the first screen comes back, which is the only way to reach the
   * other example trips once one has been run. Leaving a priced comparison on
   * screen under two empty fields was the stale half of a route nobody was
   * looking at any more.
   */
  const setPickup = useCallback(
    (next: PlaceValue | null) => {
      setPickupEdit(next);
      draft.remember(next, destination);
      if (!next && !destination) reset();
    },
    [draft, destination, reset],
  );
  const setDestination = useCallback(
    (next: PlaceValue | null) => {
      setDestinationEdit(next);
      draft.remember(pickup, next);
      if (!next && !pickup) reset();
    },
    [draft, pickup, reset],
  );
  const [filter, setFilter] = useState<ResultFilter>('BEST');
  const [mode, setMode] = useState<RankMode>('CHEAPEST');
  const [passengers, setPassengers] = useState(1);
  /**
   * When the rider is leaving, as an ISO instant, or null for now.
   *
   * Deliberately not persisted with the route draft: a departure is about one
   * trip on one day, and finding yesterday's 6am flight still selected on a
   * reload would be a worse surprise than retyping it.
   */
  const [departAt, setDepartAt] = useState<string | null>(null);
  /**
   * What the *rendered* prices are for, which is not the same as what the
   * control currently says. Changing the picker and not pressing Compare must
   * not relabel numbers that were computed for a different moment.
   */
  const scheduledQuote = state.session?.quotes.find((q) => q.scheduledFor) ?? null;
  const scheduledFor = scheduledQuote?.scheduledFor ?? null;
  const scheduledLabel = scheduledFor
    ? describeDeparture(
        scheduledFor,
        // The market-local clock of the very instant that was priced, stamped
        // by whichever tariff source answered.
        typeof scheduledQuote?.metadata.fareClockNowLabel === 'string'
          ? scheduledQuote.metadata.fareClockNowLabel
          : null,
        typeof scheduledQuote?.metadata.market === 'string'
          ? scheduledQuote.metadata.market
          : typeof scheduledQuote?.metadata.system === 'string'
            ? scheduledQuote.metadata.system
            : null,
      )
    : null;
  const [booking, setBooking] = useState<NormalizedQuote | null>(null);
  const [inspecting, setInspecting] = useState<NormalizedQuote | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  /**
   * Geometry is stored against the route it belongs to and read back only for
   * a matching route, so a stale path can never be drawn over a new one and no
   * effect has to null it out.
   */
  const [geoCache, setGeoCache] = useState<{ key: string; value: RouteGeometry } | null>(null);
  const [stationCache, setStationCache] = useState<{ key: string; value: MapStation[] } | null>(
    null,
  );
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stuck, setStuck] = useState(false);

  const pickupRef = useRef<HTMLInputElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const autoRanRef = useRef(false);

  const canCompare = Boolean(pickup && destination) && !busy;

  /**
   * Take a time off the chart and re-price for it.
   *
   * The offset is measured from the axis origin, which is whatever instant the
   * sources priced — the chosen departure if there is one, otherwise the moment
   * the quotes were computed. Anchoring on the quote rather than on `Date.now`
   * matters: by the time someone has dragged to eight in the evening, "now" has
   * moved, and re-anchoring would land them a minute or two off what they saw.
   */
  const adoptDeparture = useCallback(
    (offsetMinutes: number) => {
      const anchorIso = scheduledFor ?? state.session?.quotes[0]?.receivedAt ?? null;
      if (!anchorIso || !pickup || !destination) return;
      const anchor = Date.parse(anchorIso);
      if (!Number.isFinite(anchor)) return;
      const chosen = new Date(anchor + offsetMinutes * 60_000).toISOString();
      setDepartAt(chosen);
      void run(pickup, destination, false, passengers, chosen);
    },
    [scheduledFor, state.session, pickup, destination, passengers, run],
  );

  /**
   * Run one of the example trips.
   *
   * It fills the same two fields a rider would fill and takes the same path —
   * the live geocoder resolves the coordinates, the routing service measures
   * the route, the tariff prices it. Nothing about the result is prepared: the
   * fields stay filled afterwards precisely so the trip can be edited into the
   * rider's own, which is the point of starting them somewhere rather than
   * nowhere.
   */
  const runExample = useCallback(
    (trip: ExampleTrip) => {
      const from: PlaceValue = { label: trip.fromLabel, suggestionId: null, coords: trip.from };
      const to: PlaceValue = { label: trip.toLabel, suggestionId: null, coords: trip.to };
      /*
       * The raw editors, and one `remember`, rather than `setPickup` then
       * `setDestination`. Those two each persist the draft using the *other*
       * field as it was at render, so calling them in sequence would store the
       * old pickup beside the new destination — a route nobody chose, waiting
       * on the next reload.
       */
      setPickupEdit(from);
      setDestinationEdit(to);
      draft.remember(from, to);
      setDepartAt(null);
      places.rememberRoute(from, to);
      setShareUrl(null);
      setShareError(null);
      void run(from, to, false, passengers, null);
    },
    [run, draft, places, passengers],
  );

  const submit = useCallback(
    (refresh = false) => {
      if (!pickup || !destination) return;
      // Remembered on submit, not on completion: the rider's intent is what is
      // worth recalling, whether or not any provider answered.
      if (!refresh) {
        places.rememberRoute(pickup, destination);
        setShareUrl(null);
        setShareError(null);
      }
      void run(pickup, destination, refresh, passengers, departAt);
    },
    [pickup, destination, run, places, passengers, departAt],
  );

  // Changing the party size changes the fare in cities that charge per
  // passenger, so results already on screen have to be re-priced rather than
  // just re-filtered. Debounced, because the control is a row of buttons and a
  // rider clicking from 1 to 4 should cost one call, not three.
  const pricedForRef = useRef(passengers);
  useEffect(() => {
    if (!state.session || state.phase !== 'done') return;
    if (pricedForRef.current === passengers) return;
    const t = setTimeout(() => {
      pricedForRef.current = passengers;
      submit(true);
    }, 700);
    return () => clearTimeout(t);
  }, [passengers, state.session, state.phase, submit]);

  // A share link lands with both endpoints already set: run it immediately, so
  // the recipient sees live prices rather than a form they must re-submit.
  useEffect(() => {
    if (!initialRoute || autoRanRef.current) return;
    autoRanRef.current = true;
    void run(initialRoute.pickup, initialRoute.destination, false);
  }, [initialRoute, run]);

  // Road geometry is fetched only after results exist: the map is context, and
  // a slow routing service must never delay a fare.
  const routeKey = state.header
    ? `${state.header.pickup.lat},${state.header.pickup.lng}->${state.header.destination.lat},${state.header.destination.lng}`
    : null;
  const geometry = geoCache && geoCache.key === routeKey ? geoCache.value : null;

  useEffect(() => {
    const header = state.header;
    if (!header || !routeKey) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pickup: { lat: header.pickup.lat, lng: header.pickup.lng },
            destination: { lat: header.destination.lat, lng: header.destination.lng },
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { geometry?: RouteGeometry | null };
        if (!cancelled && data.geometry) setGeoCache({ key: routeKey, value: data.geometry });
      } catch {
        // A missing route line is cosmetic; the straight-line schematic stands.
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [state.header, routeKey]);

  const stations = stationCache && stationCache.key === routeKey ? stationCache.value : [];

  /**
   * Live bike-share stations for the map. Requested alongside geometry and
   * after results exist: the dots are context, and a slow feed must never hold
   * up a fare.
   *
   * Only when a bike could actually make the trip. On a seventeen-mile airport
   * run the app itself says "too far for a shared bike" and then drew
   * forty-eight stations anyway — a ring of blue dots crowding the pickup
   * marker, answering a question nobody asked. Context that is not relevant is
   * just clutter.
   */
  useEffect(() => {
    const header = state.header;
    if (!header || !routeKey) return;
    const straightLine = header.straightLineMeters;
    if (typeof straightLine === 'number' && straightLine > MAX_BIKE_METERS) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/stations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pickup: { lat: header.pickup.lat, lng: header.pickup.lng },
            destination: { lat: header.destination.lat, lng: header.destination.lng },
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { stations?: MapStation[] };
        if (!cancelled && data.stations?.length) {
          setStationCache({ key: routeKey, value: data.stations });
        }
      } catch {
        // Station dots are decoration; their absence changes no price.
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [state.header, routeKey]);

  // Sticky toolbar gets a hairline only once it is actually stuck.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry?.isIntersecting), {
      threshold: 1,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [state.header]);

  /**
   * On a phone, bring the prices to the rider.
   *
   * The single-column layout puts the form, the passenger control and the map
   * above the results, so tapping "Compare rides" leaves the answer a full
   * screen below the fold — you search, and nothing appears to happen. On a
   * wide screen the results are already beside the form, so nothing moves.
   *
   * Only on a fresh comparison: a background auto-refresh must never yank the
   * page while someone is reading.
   */
  const scrolledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase !== 'done' || !state.header) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    if (scrolledForRef.current === routeKey) return;
    scrolledForRef.current = routeKey;

    const el = document.getElementById('main');
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [state.phase, state.header, routeKey]);

  /*
   * Auto-refresh has nothing to do for a fare fixed by rule for a future
   * instant: every poll returns the identical number, and the ticking countdown
   * implies a volatility the price does not have.
   */
  const live = useLiveRefresh(
    () => submit(true),
    Boolean(pickup && destination) && !busy && departAt === null,
  );

  useShortcuts(
    useMemo(
      () => ({
        focusSearch: () => pickupRef.current?.focus(),
        refresh: () => {
          if (canCompare || state.header) submit(state.header !== null);
        },
        toggleHelp: () => setHelpOpen((v) => !v),
        closeAll: () => {
          setInspecting(null);
          setBooking(null);
          setHelpOpen(false);
        },
      }),
      [canCompare, state.header, submit],
    ),
    !booking && !inspecting,
  );

  // Quotes re-derive their freshness from `now`, so a card ages while visible.
  const allQuotes = useMemo(
    () => (state.session?.quotes ?? []).map((q) => refreshQuoteFreshness(q, now)),
    [state.session, now],
  );

  /**
   * The vehicle comparison. A shared bike and a commuter train are deliberately
   * excluded: they are different modes, almost always cheaper, and letting one
   * win "cheapest ride" would quietly turn a ride comparison into a mode
   * comparison. Neither of them comes to the door, either. They get their own
   * section below instead.
   */
  const quotes = useMemo(
    () =>
      filterByParty(
        allQuotes.filter((q) => !OTHER_MODES.has(q.normalizedCategory)),
        passengers,
      ),
    [allQuotes, passengers],
  );

  /** Sorted cheapest first: within the section they are comparable to each other. */
  const otherModeQuotes = useMemo(
    () =>
      allQuotes
        .filter((q) => OTHER_MODES.has(q.normalizedCategory))
        .sort((a, b) => a.rankingPriceMinor - b.rankingPriceMinor),
    [allQuotes],
  );

  const counts = useMemo(() => {
    const out: Partial<Record<ResultFilter, number>> = {};
    for (const f of ['BEST', 'STANDARD', 'XL', 'PREMIUM', 'TAXI', 'ALL'] as ResultFilter[]) {
      out[f] = applyFilter(quotes, f).length;
    }
    return out;
  }, [quotes]);

  /**
   * If the selected filter has no results, fall back to ALL. Derived during
   * render rather than corrected in an effect, so the list never flashes empty
   * for a frame before the fallback applies.
   */
  const effectiveFilter: ResultFilter = quotes.length > 0 && counts[filter] === 0 ? 'ALL' : filter;

  const visible = useMemo(
    () => rankQuotes(applyFilter(quotes, effectiveFilter), mode),
    [quotes, effectiveFilter, mode],
  );

  const hero = visible[0] ?? null;
  const rest = visible.slice(1);

  const heroHeadline = useMemo(() => {
    if (!hero || mode !== 'CHEAPEST') return null;
    const runnerUp = rest[0];
    /*
     * "Only option" is a claim about the page, and the page may well be
     * showing a train underneath. It is only ever true when nothing else
     * answered at all; otherwise the honest badge names what it is the only
     * one of.
     */
    if (!runnerUp) return otherModeQuotes.length > 0 ? 'Only car' : 'Only option';
    if (runnerUp.currency !== hero.currency) return null;
    return headlineFor(compareWithUncertainty(intervalOf(hero), intervalOf(runnerUp)));
  }, [hero, rest, mode, otherModeQuotes]);

  /**
   * The cheapest way to make this trip, when it is not the one leading the ride
   * ranking. Null the rest of the time, which is most of the time — a verdict
   * that fires on every comparison is a banner.
   */
  const verdict = useMemo(() => tripVerdict(visible, otherModeQuotes), [visible, otherModeQuotes]);

  const fastest = useMemo(() => fastestPickup(visible), [visible]);

  const discrepancyByQuote = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of state.session?.discrepancies ?? []) {
      const notice = discrepancyNotice(d);
      if (notice) map.set(d.canonicalQuoteId, notice);
    }
    return map;
  }, [state.session]);

  const deltaFor = useCallback(
    (q: NormalizedQuote): PriceDelta | null => {
      const prev = state.previousPrices[q.id];
      if (prev === undefined) return null;
      const diff = q.rankingPriceMinor - prev;
      if (diff === 0) return { direction: 'same', minor: 0 };
      return { direction: diff > 0 ? 'up' : 'down', minor: Math.abs(diff) };
    },
    [state.previousPrices],
  );

  const quickPicks = useCallback(
    (which: 'pickup' | 'destination'): QuickPick[] => {
      const out: QuickPick[] = [];
      for (const slot of ['home', 'work'] as SavedSlot[]) {
        const saved = places.saved[slot];
        if (saved) {
          out.push({
            id: `saved-${slot}`,
            label: slot === 'home' ? 'Home' : 'Work',
            sublabel: saved.label,
            kind: slot === 'home' ? 'HOME' : 'WORK',
            value: saved,
          });
        }
      }
      for (const r of places.recents.slice(0, 4)) {
        const v = which === 'pickup' ? r.pickup : r.destination;
        if (out.some((p) => p.value.label === v.label)) continue;
        out.push({
          id: `recent-${which}-${v.label}`,
          label: v.label.split(',')[0] ?? v.label,
          sublabel: v.label,
          kind: 'RECENT',
          value: v,
        });
      }
      return out;
    },
    [places.saved, places.recents],
  );

  const openBooking = useCallback((q: NormalizedQuote) => {
    setHandoffError(null);
    setInspecting(null);
    setBooking(q);
  }, []);

  const continueBooking = useCallback(async () => {
    if (!booking?.bookingHandoff) return;
    // Nothing to navigate to: the sheet was the whole answer.
    if (booking.bookingHandoff.url === null) {
      setBooking(null);
      return;
    }
    setHandoffPending(true);
    setHandoffError(null);
    try {
      // The server re-validates the destination against the allowlist; the
      // client never navigates to a URL straight out of a quote payload.
      const res = await fetch('/api/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: booking.provider,
          url: booking.bookingHandoff.url,
          quoteKey: booking.id,
          sessionId: state.session?.id ?? null,
          handoffKind: booking.bookingHandoff.kind,
          observedPriceMinor: booking.displayPriceMinor,
          currency: booking.currency,
          quoteAgeMs: Math.max(0, Date.now() - Date.parse(booking.receivedAt)),
        }),
      });
      const data = (await res.json()) as { url?: string; message?: string };
      if (!res.ok || !data.url) {
        setHandoffError(data.message ?? 'That booking link could not be verified.');
        return;
      }
      window.open(data.url, '_blank', 'noopener,noreferrer');
      setBooking(null);
    } catch {
      setHandoffError(
        online
          ? 'Could not open the provider. Try again.'
          : 'You appear to be offline. Reconnect and try again.',
      );
    } finally {
      setHandoffPending(false);
    }
  }, [booking, state.session, online]);

  const createShare = useCallback(async () => {
    if (!pickup || !destination) return;
    setSharing(true);
    setShareError(null);
    try {
      const toInput = (v: PlaceValue) =>
        v.suggestionId
          ? { kind: 'suggestion' as const, id: v.suggestionId }
          : v.coords
            ? { kind: 'coords' as const, lat: v.coords.lat, lng: v.coords.lng, label: v.label }
            : { kind: 'query' as const, text: v.label };
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup: toInput(pickup), destination: toInput(destination) }),
      });
      const data = (await res.json()) as { url?: string; message?: string; durable?: boolean };
      if (!res.ok || !data.url) {
        setShareError(data.message ?? 'Could not create a share link.');
        return;
      }
      setShareUrl(data.url);
      if (data.durable === false) {
        setShareError('This link works only while the local server is running.');
      }
    } catch {
      setShareError('Could not create a share link.');
    } finally {
      setSharing(false);
    }
  }, [pickup, destination]);

  const skeletonProviders = state.header?.providersExpected ?? [];
  const showResults = quotes.length > 0;

  /**
   * Every option whose fare is a published rule on a clock, and where "now"
   * sits on that clock. Cars and trains alike: the day view is about the trip,
   * not about one mode.
   */
  const departureOptions = useMemo<DepartureOption[]>(
    () =>
      [...quotes, ...otherModeQuotes].flatMap((q) => {
        const raw = q.metadata.fareDayBands;
        if (typeof raw !== 'string') return [];
        try {
          const bands = JSON.parse(raw) as DepartureOption['bands'];
          if (!Array.isArray(bands) || bands.length === 0) return [];
          return [
            {
              id: q.id,
              provider: q.provider,
              label: q.providerProductName,
              currency: q.currency,
              bands,
            },
          ];
        } catch {
          return [];
        }
      }),
    [quotes, otherModeQuotes],
  );

  /*
   * Filters and sorts are controls, and a control that cannot change anything
   * is furniture. With the market-priced providers gated, the flagship trip —
   * Manhattan to JFK — used to render one card under five category chips and
   * three sort orders, which made a complete answer look like an empty one.
   */
  const filterableCount = ['STANDARD', 'XL', 'PREMIUM', 'TAXI'].filter(
    (f) => (counts[f as ResultFilter] ?? 0) > 0,
  ).length;
  const showFilterBar = showResults && (quotes.length > 1 || filterableCount > 1);

  return (
    <div style={{ minHeight: '100dvh' }}>
      <div
        className="rl-shell"
        style={{
          width: '100%',
          maxWidth: 'var(--shell-max)',
          margin: '0 auto',
          padding: 'var(--sp-5) var(--sp-4) calc(var(--sp-9) + env(safe-area-inset-bottom, 0px))',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          columnGap: 'var(--sp-5)',
          rowGap: 'var(--sp-5)',
          alignItems: 'start',
        }}
      >
        {/* ── App bar ───────────────────────────────────────────────────── */}
        <div className="rl-appbar">
          <BrandLockup heading size={34} tagline="Every ride. One live comparison." />
          <span
            className="tnum rl-appbar-status"
            style={{
              fontSize: 'var(--t-xs)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-4)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 'var(--r-full)',
                background: liveDataAvailable ? 'var(--best)' : 'var(--warn)',
              }}
            />
            {liveDataAvailable ? 'Live sources connected' : 'No live source'}
          </span>
        </div>

        {/* ── Rail ──────────────────────────────────────────────────────── */}
        <aside className="rl-rail thin-scroll" style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          {!online && (
            <Banner tone="danger" testId="offline-banner">
              <strong>You are offline.</strong> Prices cannot be fetched until the connection
              returns.
            </Banner>
          )}

          {!liveDataAvailable && (
            <Banner tone="warn" testId="no-live-source">
              <strong style={{ display: 'block', marginBottom: 'var(--sp-05)' }}>
                No live source connected
              </strong>
              {blockerSummary ??
                'RideLens has no authorized live quote source configured, so no prices can be shown.'}
            </Banner>
          )}

          {fixtureBacked && (
            <div
              role="status"
              data-testid="fixture-banner"
              style={{
                padding: '8px 11px',
                fontSize: 'var(--t-xs)',
                color: 'var(--text-2)',
                background: 'var(--surface-sunken)',
                border: '1px dashed var(--border-emphasis)',
                borderRadius: 'var(--r-md)',
              }}
            >
              Fixture data — a local demo, not a live market price.
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(false);
            }}
            style={{ display: 'grid', gap: 'var(--sp-4)' }}
          >
            <PlaceInput
              label="Pickup"
              placeholder="Where are you?"
              value={pickup}
              onChange={setPickup}
              allowCurrentLocation
              quickPicks={quickPicks('pickup')}
              testId="pickup-input"
              inputRef={pickupRef}
              accessory={
                pickup ? (
                  <SavePlaceMenu
                    onSave={(slot) => places.savePlace(slot, pickup)}
                    saved={places.saved}
                    current={pickup}
                  />
                ) : null
              }
            />
            <PlaceInput
              label="Destination"
              placeholder="Where are you going?"
              value={destination}
              onChange={setDestination}
              bias={pickup?.coords ?? null}
              quickPicks={quickPicks('destination')}
              testId="destination-input"
              accessory={
                destination ? (
                  <SavePlaceMenu
                    onSave={(slot) => places.savePlace(slot, destination)}
                    saved={places.saved}
                    current={destination}
                  />
                ) : null
              }
            />
            <DepartureTime
              value={departAt}
              onChange={setDepartAt}
              horizonDays={SCHEDULE_HORIZON_DAYS}
            />
            <button
              type="submit"
              data-testid="compare-button"
              disabled={!canCompare}
              className="rl-press"
              style={{
                minHeight: 48,
                fontSize: 'var(--t-md)',
                fontWeight: 650,
                fontFamily: 'var(--font-sans)',
                color: canCompare ? 'var(--on-inverse)' : 'var(--text-4)',
                background: canCompare ? 'var(--surface-inverse)' : 'var(--surface-sunken)',
                border: `1px solid ${canCompare ? 'var(--surface-inverse)' : 'var(--border)'}`,
                borderRadius: 'var(--r-md)',
                cursor: canCompare ? 'pointer' : 'not-allowed',
                boxShadow: canCompare ? 'var(--e-2)' : 'none',
              }}
            >
              {busy ? 'Comparing…' : departAt ? 'Price that departure' : 'Compare rides'}
            </button>
          </form>

          <PartySize
            value={passengers}
            onChange={setPassengers}
            affectsPrice={state.phase === 'done'}
          />

          {state.history.length >= 2 && <PriceHistory history={state.history} />}

          {state.header && (
            <div>
              <RouteMap
                pickup={state.header.pickup}
                destination={state.header.destination}
                geometry={geometry}
                stations={stations}
                height={248}
              />
              <RouteFacts header={state.header} geometry={geometry} now={now} />
            </div>
          )}

          {places.hasAny && (
            <button
              type="button"
              onClick={() => {
                places.clearAll();
                draft.forget();
              }}
              data-testid="clear-places"
              className="rl-tap"
              style={{
                justifySelf: 'start',
                padding: 0,
                background: 'none',
                border: 'none',
                fontSize: 'var(--t-xs)',
                color: 'var(--text-4)',
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              Clear saved places and history
            </button>
          )}
        </aside>

        {/* ── Results ───────────────────────────────────────────────────── */}
        {/* A fare card is a line of text and a button. Let it run the width of
            a 1440px monitor and the price ends up at one end and the action at
            the other, which reads as unfinished rather than spacious. */}
        <main id="main" style={{ display: 'grid', gap: 'var(--sp-4)', minWidth: 0, maxWidth: 720 }}>
          {state.phase === 'idle' && (
            <EmptyState
              liveDataAvailable={liveDataAvailable}
              coveredMarkets={coveredMarkets}
              bikeSystems={bikeSystems}
              railSystems={railSystems}
              onShowShortcuts={() => setHelpOpen(true)}
              onPickExample={runExample}
            />
          )}

          {state.phase === 'error' && (
            <p
              role="alert"
              data-testid="session-error"
              style={{
                margin: 0,
                padding: '13px 15px',
                fontSize: 'var(--t-base)',
                color: 'var(--danger)',
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger-line)',
                borderRadius: 'var(--r-lg)',
              }}
            >
              {state.error}
              {!online && ' You appear to be offline.'}
            </p>
          )}

          {state.header && (
            <>
              <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
              <SessionToolbar
                busy={busy}
                lastUpdatedAt={state.lastUpdatedAt}
                now={now}
                onRefresh={() => {
                  live.reset();
                  submit(true);
                }}
                live={live.state}
                onToggleLive={live.toggle}
                onShare={() => void createShare()}
                onCopySummary={() =>
                  buildTripSummary({
                    // The short form: a pasted summary wants the name of the
                    // place, not its full administrative address.
                    pickupLabel: state.header ? shortAddress(state.header.pickup) : 'Pickup',
                    destinationLabel: state.header
                      ? shortAddress(state.header.destination)
                      : 'Destination',
                    quotes: [...quotes, ...otherModeQuotes],
                    unavailable: state.outcomes
                      .filter((o) => o.message)
                      .map((o) => ({ label: o.sourceId, reason: o.message ?? '' })),
                    at: new Date(state.lastUpdatedAt ?? Date.now()),
                  })
                }
                sharing={sharing}
                shareUrl={shareUrl}
                shareError={shareError}
                stuck={stuck}
                scheduledLabel={scheduledLabel}
              />
            </>
          )}

          {busy && quotes.length === 0 && <SkeletonList providers={skeletonProviders} />}

          {verdict && (
            <TripVerdict
              verdict={verdict}
              roadSeconds={geometry?.durationSeconds ?? null}
              destinationLabel={destination?.label ?? null}
              onShowWinner={() => setInspecting(verdict.winner)}
            />
          )}

          {showResults && (
            <DeparturePlanner
              options={departureOptions}
              scheduled={scheduledFor !== null}
              onPickTime={adoptDeparture}
            />
          )}

          {showFilterBar && (
            <FilterBar
              filter={effectiveFilter}
              onFilter={setFilter}
              mode={mode}
              onMode={setMode}
              counts={counts}
            />
          )}

          {mode === 'BEST_VALUE' && showFilterBar && (
            <p style={{ margin: 0, fontSize: 'var(--t-xs)', color: 'var(--text-3)' }}>
              {BEST_VALUE_EXPLANATION}
            </p>
          )}

          {hero && (
            <QuoteCard
              quote={hero}
              destinationLabel={destination?.label ?? null}
              hero
              headline={heroHeadline}
              savings={savingsFor(hero, visible)}
              now={now}
              delta={deltaFor(hero)}
              discrepancyNotice={discrepancyByQuote.get(hero.id) ?? null}
              passengers={passengers}
              onBook={openBooking}
              onInspect={setInspecting}
            />
          )}

          {fastest && hero && fastest.id !== hero.id && mode === 'CHEAPEST' && (
            <p
              data-testid="fastest-note"
              style={{ margin: 0, fontSize: 'var(--t-sm)', color: 'var(--text-2)' }}
            >
              Fastest pickup is {providerProfile(fastest.provider).displayName}{' '}
              {fastest.providerProductName} at {formatEta(fastest.pickupEtaSeconds)}.
            </p>
          )}

          {rest.length > 0 && (
            <section aria-label="All options" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <h2 className="eyebrow" style={{ marginTop: 'var(--sp-05)' }}>
                All options
              </h2>
              <div className="stagger" style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                {rest.map((q) => (
                  <QuoteCard
                    key={q.id}
                    quote={q}
                    destinationLabel={destination?.label ?? null}
                    savings={savingsFor(q, visible)}
                    now={now}
                    delta={deltaFor(q)}
                    discrepancyNotice={discrepancyByQuote.get(q.id) ?? null}
                    passengers={passengers}
                    onBook={openBooking}
                    onInspect={setInspecting}
                  />
                ))}
              </div>
            </section>
          )}

          {otherModeQuotes.length > 0 && (
            <section
              aria-label="Other ways to get there"
              style={{ display: 'grid', gap: 'var(--sp-2)' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'var(--sp-2)',
                  marginTop: 'var(--sp-05)',
                }}
              >
                {/* The subtitle explains an exclusion, so it only makes sense
                    when there is a ride ranking to have been excluded from. */}
                <h2 className="eyebrow">
                  {visible.length > 0 ? 'Other ways to get there' : 'How to get there'}
                </h2>
                <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-4)' }}>
                  {visible.length > 0
                    ? 'a different mode, kept out of the ride ranking'
                    : 'no car is priced for this route, but these are'}
                </span>
              </div>
              {otherModeQuotes.map((q) => (
                <QuoteCard
                  key={q.id}
                  quote={q}
                  destinationLabel={destination?.label ?? null}
                  savings={null}
                  now={now}
                  delta={deltaFor(q)}
                  discrepancyNotice={null}
                  passengers={passengers}
                  onBook={openBooking}
                  onInspect={setInspecting}
                />
              ))}
            </section>
          )}

          {state.phase === 'done' && quotes.length === 0 && otherModeQuotes.length === 0 && (
            <p
              data-testid="no-quotes"
              style={{
                margin: 0,
                padding: '14px 16px',
                fontSize: 'var(--t-base)',
                color: 'var(--text-2)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)',
                lineHeight: 1.55,
              }}
            >
              {passengers > 1 && (state.session?.quotes.length ?? 0) > 0
                ? `No option seats ${passengers} passengers. Lower the passenger count to see the rest.`
                : 'No provider returned a price for this route. Nothing is being estimated on their behalf — see the source status below.'}
            </p>
          )}

          {state.outcomes.length > 0 && (
            <SourceStatus
              outcomes={state.outcomes}
              providersBySource={sourceProviders}
              defaultOpen={!showResults}
            />
          )}
        </main>
      </div>

      {booking && state.header && (
        <HandoffDialog
          quote={booking}
          pickup={state.header.pickup}
          destination={state.header.destination}
          now={now}
          pending={handoffPending}
          error={handoffError}
          shareUrl={shareUrl}
          onContinue={() => void continueBooking()}
          onCancel={() => setBooking(null)}
        />
      )}

      <RideDetailSheet
        quote={inspecting}
        candidates={state.session?.candidates ?? []}
        discrepancy={
          state.session?.discrepancies.find((d) => d.canonicalQuoteId === inspecting?.id) ?? null
        }
        now={now}
        destinationLabel={destination?.label ?? null}
        onClose={() => setInspecting(null)}
        onBook={openBooking}
      />

      <ShortcutHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function Banner({
  tone,
  testId,
  children,
}: {
  tone: 'warn' | 'danger';
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      style={{
        padding: '10px 12px',
        fontSize: 'var(--t-sm)',
        lineHeight: 1.5,
        color: tone === 'warn' ? 'var(--warn)' : 'var(--danger)',
        background: tone === 'warn' ? 'var(--warn-soft)' : 'var(--danger-soft)',
        border: `1px solid ${tone === 'warn' ? 'var(--warn-line)' : 'var(--danger-line)'}`,
        borderRadius: 'var(--r-md)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Route facts under the map. Explicitly labelled a map estimate so it can never
 * be mistaken for a provider's own trip figures.
 *
 * The arrival clock is the same routed duration read a second way. "30 min by
 * road" needs arithmetic to be useful; "arrive ~4:12pm" is the thing a rider is
 * actually deciding about, and it costs nothing to say both.
 */
function RouteFacts({
  header,
  geometry,
  now,
}: {
  header: { straightLineMeters: number };
  geometry: RouteGeometry | null;
  now: number;
}) {
  const km = (geometry?.distanceMeters ?? header.straightLineMeters) / 1000;
  const miles = km * 0.621371;
  const mins = geometry ? Math.round(geometry.durationSeconds / 60) : null;
  const arrival = geometry
    ? new Date(now + geometry.durationSeconds * 1000).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  return (
    <p
      className="tnum"
      data-testid="route-facts"
      style={{
        marginTop: 'var(--sp-2)',
        fontSize: 'var(--t-xs)',
        lineHeight: 1.5,
        color: 'var(--text-3)',
      }}
    >
      {geometry ? (
        <>
          ≈ {miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi · {mins} min by road
          {arrival && <> · arrive ~{arrival}</>}
          {/* A token, not `opacity`. Fading text over a background lands on a
              colour nobody chose, and this one came out at 3.32:1. */}
          <span style={{ color: 'var(--text-4)' }}> · map estimate</span>
        </>
      ) : (
        <>
          {miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi direct
          <span style={{ color: 'var(--text-4)' }}> · straight line</span>
        </>
      )}
    </p>
  );
}

function SavePlaceMenu({
  onSave,
  saved,
  current,
}: {
  onSave: (slot: SavedSlot) => void;
  saved: Partial<Record<SavedSlot, PlaceValue>>;
  current: PlaceValue;
}) {
  const isHome = saved.home?.label === current.label;
  const isWork = saved.work?.label === current.label;
  if (isHome || isWork) {
    return (
      <span className="eyebrow" style={{ color: 'var(--text-3)' }}>
        Saved as {isHome ? 'Home' : 'Work'}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
      {(['home', 'work'] as SavedSlot[]).map((slot) => (
        <button
          key={slot}
          type="button"
          data-testid={`save-${slot}`}
          onClick={() => onSave(slot)}
          className="rl-tap"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            fontSize: 'var(--t-xs)',
            fontWeight: 550,
            color: 'var(--text-3)',
            cursor: 'pointer',
          }}
        >
          Save {slot === 'home' ? 'Home' : 'Work'}
        </button>
      ))}
    </span>
  );
}
