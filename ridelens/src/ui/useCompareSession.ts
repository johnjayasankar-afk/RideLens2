'use client';

/**
 * Streaming comparison state.
 *
 * Reads the NDJSON stream from /api/quotes/stream and updates as each source
 * settles. Two behaviours matter for truthfulness:
 *   - a source that fails contributes an error row, never substitute prices;
 *   - `now` ticks once a second so freshness labels age in place and an
 *     expired quote stops being presented as current while it is on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  NormalizedQuote,
  ProviderId,
  QuoteSession,
  SourceId,
  SourceOutcome,
} from '@/domain/quote';
import type { CanonicalLocation } from '@/location/types';
import type { PlaceValue } from './PlaceInput';

export interface SessionHeader {
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  straightLineMeters: number;
  sourcesExpected: SourceId[];
  providersExpected: ProviderId[];
  fixtureBacked: boolean;
}

export type Phase = 'idle' | 'resolving' | 'streaming' | 'done' | 'error';

/**
 * One entry per completed comparison in this screen's lifetime. Scoped to the
 * session on purpose: RideLens keeps no long-term price analytics, and a
 * remembered fare from yesterday is not a fare.
 */
export interface HistoryPoint {
  at: number;
  cheapestMinor: number;
  currency: string;
  provider: ProviderId;
  productName: string;
}

export interface CompareState {
  phase: Phase;
  header: SessionHeader | null;
  outcomes: SourceOutcome[];
  /** Quotes seen so far, pre-reconciliation, for progressive rendering. */
  partialQuotes: NormalizedQuote[];
  session: QuoteSession | null;
  error: string | null;
  lastUpdatedAt: number | null;
  /** Ranking price per quote key from the previous run, for the ↑↓ indicator. */
  previousPrices: Record<string, number>;
  /** Cheapest bookable price per completed run, oldest first. */
  history: HistoryPoint[];
}

const INITIAL: CompareState = {
  phase: 'idle',
  header: null,
  outcomes: [],
  partialQuotes: [],
  session: null,
  error: null,
  lastUpdatedAt: null,
  previousPrices: {},
  history: [],
};

/**
 * Records the cheapest genuinely bookable option. Unavailable and expired
 * quotes are excluded, because a history of prices nobody could book would be
 * a chart of nothing.
 */
function appendHistory(history: HistoryPoint[], session: QuoteSession, at: number): HistoryPoint[] {
  const cheapest = session.quotes.find(
    (q) => q.availability === 'AVAILABLE' && q.freshness !== 'EXPIRED' && q.priceType !== 'UNKNOWN',
  );
  if (!cheapest) return history;
  const point: HistoryPoint = {
    at,
    cheapestMinor: cheapest.rankingPriceMinor,
    currency: cheapest.currency,
    provider: cheapest.provider,
    productName: cheapest.providerProductName,
  };
  // Bounded: this is a live readout, not an analytics store.
  return [...history, point].slice(-12);
}

function toInput(value: PlaceValue) {
  if (value.suggestionId) return { kind: 'suggestion' as const, id: value.suggestionId };
  if (value.coords) {
    return {
      kind: 'coords' as const,
      lat: value.coords.lat,
      lng: value.coords.lng,
      label: value.label,
    };
  }
  return { kind: 'query' as const, text: value.label };
}

export function useCompareSession() {
  const [state, setState] = useState<CompareState>(INITIAL);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const inFlight = useRef(false);

  // Freshness must age while the results sit on screen.
  useEffect(() => {
    if (state.phase !== 'done' && state.phase !== 'streaming') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);

  const run = useCallback(
    async (
      pickup: PlaceValue,
      destination: PlaceValue,
      refresh = false,
      partySize = 1,
      /** ISO instant to price for, when the rider is planning rather than going. */
      departAt: string | null = null,
    ) => {
      // Debounce duplicate submits: a double click must not double-spend an
      // upstream call.
      if (inFlight.current) return;
      inFlight.current = true;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({
        ...INITIAL,
        phase: 'resolving',
        previousPrices: refresh
          ? Object.fromEntries((prev.session?.quotes ?? []).map((q) => [q.id, q.rankingPriceMinor]))
          : {},
        // A refresh continues this screen's history; a new route starts a fresh
        // one, because two different trips share no price line.
        history: refresh ? prev.history : [],
      }));

      try {
        const res = await fetch('/api/quotes/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pickup: toInput(pickup),
            destination: toInput(destination),
            refresh,
            // Chicago and DC publish a per-passenger charge, so the party size is
            // part of the fare rather than only a filter on what fits.
            partySize,
            ...(departAt ? { departAt } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const payload = (await res.json().catch(() => null)) as { message?: string } | null;
          setState((s) => ({
            ...s,
            phase: 'error',
            error: payload?.message ?? 'Comparison failed. Try again.',
          }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!raw) continue;

            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (evt.type === 'session') {
              const header = evt as unknown as SessionHeader;
              setState((s) => ({ ...s, phase: 'streaming', header }));
            } else if (evt.type === 'source') {
              const outcome = evt.outcome as SourceOutcome;
              const quotes = (evt.quotes ?? []) as NormalizedQuote[];
              setState((s) => ({
                ...s,
                outcomes: [...s.outcomes.filter((o) => o.sourceId !== outcome.sourceId), outcome],
                partialQuotes: [...s.partialQuotes, ...quotes],
              }));
            } else if (evt.type === 'complete') {
              const session = evt.session as QuoteSession;
              const at = Date.now();
              setState((s) => ({
                ...s,
                phase: 'done',
                session,
                outcomes: session.outcomes,
                lastUpdatedAt: at,
                history: appendHistory(s.history, session, at),
              }));
              setNow(at);
            } else if (evt.type === 'error') {
              setState((s) => ({
                ...s,
                phase: 'error',
                error: String(evt.message ?? 'Comparison failed.'),
              }));
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setState((s) => ({ ...s, phase: 'error', error: 'Network problem. Try again.' }));
      } finally {
        inFlight.current = false;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    inFlight.current = false;
    setState(INITIAL);
  }, []);

  return {
    state,
    now,
    run,
    reset,
    busy: state.phase === 'resolving' || state.phase === 'streaming',
  };
}
