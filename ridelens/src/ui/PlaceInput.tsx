'use client';

/**
 * Address combobox for pickup and destination.
 *
 * Implements the ARIA 1.2 combobox pattern: the input owns the listbox,
 * aria-activedescendant tracks the highlighted option, and Arrow/Enter/Escape
 * behave as a keyboard user expects. Saved places and recent destinations
 * appear as quick picks on focus, so the common case is one keystroke.
 *
 * Location privacy: this never asks for geolocation on mount. "Use current
 * location" is an explicit press, the only moment where the prompt has enough
 * context to be reasonable, and denial is a normal path that leaves search
 * fully usable.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PlaceSuggestion } from '@/location/types';

export interface PlaceValue {
  label: string;
  /** Suggestion token, or null when the value came from coordinates. */
  suggestionId: string | null;
  coords: { lat: number; lng: number } | null;
}

export interface QuickPick {
  id: string;
  label: string;
  sublabel?: string;
  kind: 'HOME' | 'WORK' | 'RECENT';
  value: PlaceValue;
}

/**
 * Join the two suggestion lines without repeating the first inside the second.
 * Some geocoders return a secondary line that already contains the primary
 * ("14 Prince St" + "14 Prince St, New York, NY"), which stutters if joined.
 */
export function buildLabel(s: Pick<PlaceSuggestion, 'primaryText' | 'secondaryText'>): string {
  const primary = s.primaryText.trim();
  const secondary = s.secondaryText.trim();
  if (!secondary) return primary;
  if (!primary) return secondary;
  const lead = primary.toLowerCase();
  const rest = secondary.toLowerCase();
  if (rest === lead) return primary;
  if (rest.startsWith(`${lead},`) || rest.startsWith(`${lead} `)) return secondary;
  return `${primary}, ${secondary}`;
}

interface Props {
  label: string;
  placeholder: string;
  value: PlaceValue | null;
  onChange: (value: PlaceValue | null) => void;
  bias?: { lat: number; lng: number } | null;
  allowCurrentLocation?: boolean;
  quickPicks?: QuickPick[];
  /** Rendered at the right of the label row, e.g. a "Save as Home" control. */
  accessory?: React.ReactNode;
  autoFocus?: boolean;
  testId?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const KIND_LABEL: Record<PlaceSuggestion['kind'], string> = {
  AIRPORT: 'Airport',
  VENUE: 'Venue',
  ADDRESS: 'Address',
  LANDMARK: 'Landmark',
  CITY: 'City',
  OTHER: '',
};

type Row = { type: 'quick'; pick: QuickPick } | { type: 'suggestion'; suggestion: PlaceSuggestion };

export function PlaceInput({
  label,
  placeholder,
  value,
  onChange,
  bias,
  allowCurrentLocation = false,
  quickPicks = [],
  accessory,
  autoFocus = false,
  testId,
  inputRef,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.label ?? '');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Sync the visible text when the PARENT sets a value (for example a quick
   * pick or "use current location"). Adjusting state during render is React's
   * documented pattern for deriving from props; an effect would cost a second
   * render pass. Clearing `value` while typing must NOT wipe the text, so only
   * a non-null label is copied down.
   */
  const incomingLabel = value?.label ?? null;
  const [syncedLabel, setSyncedLabel] = useState<string | null>(incomingLabel);
  if (incomingLabel !== syncedLabel) {
    setSyncedLabel(incomingLabel);
    if (incomingLabel !== null) setText(incomingLabel);
  }

  const typing = text.trim().length >= 2 && !(value && value.label === text);

  // Debounced so a keystroke does not equal a geocoder call.
  useEffect(() => {
    if (!typing) return;
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: text.trim() });
        if (bias) {
          params.set('lat', String(bias.lat));
          params.set('lng', String(bias.lng));
        }
        const res = await fetch(`/api/geocode/autocomplete?${params}`, {
          signal: controller.signal,
        });
        if (res.status === 429) {
          // Silence here would look like a broken field. Say what happened, and
          // that typing the full address still works.
          setSuggestError('Too many lookups just now — type the full address.');
          setSuggestions([]);
          return;
        }
        if (!res.ok) throw new Error('autocomplete failed');
        const data = (await res.json()) as {
          suggestions?: PlaceSuggestion[];
          message?: string;
        };
        setSuggestError(data.message ?? null);
        setSuggestions(data.suggestions ?? []);
        setOpen(true);
        setActive(-1);
      } catch {
        // Aborted or offline: the user can still type a full address.
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [text, bias, typing]);

  const rows: Row[] = useMemo(() => {
    if (typing) return suggestions.map((s) => ({ type: 'suggestion' as const, suggestion: s }));
    return quickPicks.map((p) => ({ type: 'quick' as const, pick: p }));
  }, [typing, suggestions, quickPicks]);

  const commit = useCallback(
    (row: Row) => {
      const next =
        row.type === 'quick'
          ? row.pick.value
          : {
              label: buildLabel(row.suggestion),
              suggestionId: row.suggestion.id,
              coords:
                row.suggestion.lat !== null && row.suggestion.lng !== null
                  ? { lat: row.suggestion.lat, lng: row.suggestion.lng }
                  : null,
            };
      onChange(next);
      setText(next.label);
      setOpen(false);
      setSuggestions([]);
      setActive(-1);
    },
    [onChange],
  );

  const useCurrentLocation = useCallback(() => {
    setLocationError(null);
    if (!('geolocation' in navigator)) {
      setLocationError('This browser cannot share your location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({
          label: 'Current location',
          suggestionId: null,
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        });
        setText('Current location');
        setOpen(false);
      },
      () => {
        setLocating(false);
        // Denial is a normal path, not an error state: search still works.
        setLocationError('Location unavailable — search for an address instead.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }, [onChange]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && !open && rows.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive(0);
      return;
    }
    if (!open || rows.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      const chosen = rows[active];
      if (chosen) {
        e.preventDefault();
        commit(chosen);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const status = loading
    ? 'Searching…'
    : open && rows.length > 0
      ? `${rows.length} ${typing ? 'suggestions' : 'saved and recent places'} available`
      : '';

  return (
    <div style={{ position: 'relative' }}>
      {/* Label row.
          Centred rather than baseline-aligned, and given a fixed height: the
          pickup row carries "Current location" and the destination row does
          not, so on a baseline the two rows sat at different heights and the
          inputs beneath them stopped lining up. A fixed 20px row makes both
          identical whatever they contain. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--sp-3)',
          height: 20,
          marginBottom: 'var(--sp-2)',
        }}
      >
        <label htmlFor={id} className="eyebrow">
          {label}
        </label>
        <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
          {accessory}
          {allowCurrentLocation && (
            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={locating}
              data-testid="use-current-location"
              aria-label="Use my current location"
              className="rl-tap"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 'var(--t-sm)',
                fontWeight: 550,
                color: 'var(--focus)',
                cursor: locating ? 'progress' : 'pointer',
              }}
            >
              {locating ? 'Locating…' : 'Current location'}
            </button>
          )}
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <input
          id={id}
          ref={inputRef}
          data-testid={testId}
          role="combobox"
          aria-expanded={open && rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            // Suggestions are cleared here, not in an effect: the keystroke is
            // the event that invalidated them.
            if (next.trim().length < 2) {
              setSuggestions([]);
              setActive(-1);
            }
            setSuggestError(null);
            if (value) onChange(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (rows.length > 0) setOpen(true);
          }}
          onBlur={() => {
            // Delay so a click on an option is not cancelled by the blur.
            blurTimer.current = setTimeout(() => setOpen(false), 130);
          }}
          className="rl-press"
          title={value ? value.label : undefined}
          style={{
            width: '100%',
            // Room on the right for the clear button, which is now 34px wide.
            padding: '11px 40px 11px 12px',
            // A chosen place can be longer than the field. Ellipsis makes that
            // read as "there is more" rather than as a hard cut mid-character;
            // the full label is on the title attribute either way.
            textOverflow: 'ellipsis',
            fontSize: 'var(--t-md)',
            fontFamily: 'var(--font-sans)',
            color: 'var(--text)',
            background: 'var(--surface)',
            border: `1px solid ${value ? 'var(--border-emphasis)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--r-md)',
            minHeight: 44,
            boxShadow: 'var(--e-1)',
          }}
        />
        {loading && (
          <span
            aria-hidden
            className="spin"
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              marginTop: -7,
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '2px solid var(--border-emphasis)',
              borderTopColor: 'var(--text-3)',
            }}
          />
        )}
        {!loading && value && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              onChange(null);
              setText('');
              setSuggestions([]);
            }}
            data-testid={`clear-${testId ?? label.toLowerCase()}`}
            style={{
              // The visible pill stays 22px; the button around it is 34, so the
              // target clears the 24px minimum with room to spare. Absolutely
              // positioned, so growing it costs the layout nothing.
              position: 'absolute',
              right: 2,
              top: '50%',
              marginTop: -17,
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--text-3)',
              cursor: 'pointer',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--surface-sunken)',
                borderRadius: 'var(--r-full)',
              }}
            >
              <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M1.5 1.5l11 11M12.5 1.5l-11 11"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </button>
        )}
      </div>

      <span aria-live="polite" className="sr-only">
        {status}
      </span>
      {locationError && (
        <p
          style={{ margin: '6px 0 0', fontSize: 'var(--t-sm)', color: 'var(--warn)' }}
          role="status"
        >
          {locationError}
        </p>
      )}
      {suggestError && (
        <p
          data-testid="suggest-error"
          role="status"
          style={{ margin: '6px 0 0', fontSize: 'var(--t-sm)', color: 'var(--warn)' }}
        >
          {suggestError}
        </p>
      )}

      {open && rows.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="thin-scroll enter"
          style={{
            position: 'absolute',
            zIndex: 40,
            top: '100%',
            left: 0,
            right: 0,
            margin: '5px 0 0',
            padding: 'var(--sp-1)',
            listStyle: 'none',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--e-3)',
            maxHeight: 292,
            overflowY: 'auto',
          }}
        >
          {!typing && (
            <li className="eyebrow" style={{ padding: '6px 8px 4px' }} aria-hidden>
              Saved &amp; recent
            </li>
          )}
          {rows.map((row, i) => {
            const isQuick = row.type === 'quick';
            const primary = isQuick ? row.pick.label : row.suggestion.primaryText;
            const secondary = isQuick ? (row.pick.sublabel ?? '') : row.suggestion.secondaryText;
            const tag = isQuick
              ? row.pick.kind === 'RECENT'
                ? 'Recent'
                : row.pick.kind === 'HOME'
                  ? 'Home'
                  : 'Work'
              : KIND_LABEL[row.suggestion.kind];

            return (
              <li
                key={isQuick ? row.pick.id : row.suggestion.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  commit(row);
                }}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: '8px 9px',
                  borderRadius: 'var(--r-sm)',
                  cursor: 'pointer',
                  background: i === active ? 'var(--surface-sunken)' : 'transparent',
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                }}
              >
                {isQuick && <QuickIcon kind={row.pick.kind} />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontWeight: 550,
                      fontSize: 'var(--t-base)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {primary}
                  </span>
                  {secondary && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 'var(--t-xs)',
                        color: 'var(--text-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {secondary}
                    </span>
                  )}
                </span>
                {tag && (
                  <span className="eyebrow" style={{ flex: '0 0 auto' }}>
                    {tag}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function QuickIcon({ kind }: { kind: QuickPick['kind'] }) {
  const path =
    kind === 'HOME'
      ? 'M2 6.5L7 2.5l5 4V12a.5.5 0 01-.5.5H9V9H5v3.5H2.5A.5.5 0 012 12V6.5z'
      : kind === 'WORK'
        ? 'M2 5h10v7.5H2V5zm3.5 0V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7V5'
        : 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM7 4.6V7l1.8 1.1';
  return (
    <span
      aria-hidden
      style={{
        flex: '0 0 26px',
        width: 26,
        height: 26,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--surface-sunken)',
        borderRadius: 'var(--r-sm)',
        color: 'var(--text-3)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path
          d={path}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
