"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface PlaceValue {
  lat: number;
  lng: number;
  placeId?: string;
  formattedAddress: string;
  label: string;
}

export type PlaceFieldHandle = {
  focus: () => void;
};

interface Suggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  formattedAddress: string;
  lat?: number;
  lng?: number;
}

export const PlaceField = forwardRef<
  PlaceFieldHandle,
  {
    label: string;
    value: PlaceValue | null;
    onChange: (v: PlaceValue | null) => void;
    placeholder: string;
    autoFocus?: boolean;
    proximity?: { lat: number; lng: number } | null;
    onPinned?: (v: PlaceValue) => void;
  }
>(function PlaceField(
  { label, value, onChange, placeholder, autoFocus, proximity, onPinned },
  ref,
) {
  const listId = useId();
  const hintId = useId();
  const [query, setQuery] = useState(value?.label || "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  const [justPinned, setJustPinned] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef(Boolean(value?.lat != null));
  const requestId = useRef(0);
  const blurCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  useEffect(() => {
    if (value) {
      selectedRef.current = true;
      setQuery(value.label || value.formattedAddress);
      setHint(null);
      setSearchedEmpty(false);
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (selectedRef.current) {
      selectedRef.current = false;
      setQuery("");
      setJustPinned(false);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurCloseRef.current) clearTimeout(blurCloseRef.current);
    };
  }, []);

  const runSearch = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (q.length < 2) {
        setSuggestions([]);
        setOpen(false);
        setSearchedEmpty(false);
        setPending(false);
        return;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const id = ++requestId.current;
      setPending(true);

      try {
        const params = new URLSearchParams({ q });
        if (proximity) {
          params.set("lat", String(proximity.lat));
          params.set("lng", String(proximity.lng));
        }
        const res = await fetch(`/api/places?${params}`, {
          signal: ac.signal,
        });
        if (id !== requestId.current) return;

        if (!res.ok) {
          setSuggestions([]);
          setOpen(true);
          setSearchedEmpty(true);
          setPending(false);
          setHint("Couldn’t search places — try again in a moment.");
          return;
        }

        const data = (await res.json()) as {
          suggestions?: Suggestion[];
          error?: string;
        };
        const list = data.suggestions || [];
        setSuggestions(list);
        setActiveIndex(0);
        setOpen(true);
        setSearchedEmpty(list.length === 0);
        setPending(false);
        setHint(
          list.length === 0
            ? "No matches — try a street, neighborhood, or airport code."
            : "Pick an address from the list",
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (id !== requestId.current) return;
        setSuggestions([]);
        setOpen(true);
        setSearchedEmpty(true);
        setPending(false);
        setHint("Couldn’t search places — check your connection.");
      } finally {
        if (id === requestId.current) setPending(false);
      }
    },
    [proximity],
  );

  const search = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length < 2) {
        abortRef.current?.abort();
        setPending(false);
        setSuggestions([]);
        setOpen(false);
        setSearchedEmpty(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        void runSearch(text);
      }, 160);
    },
    [runSearch],
  );

  const pick = async (s: Suggestion) => {
    if (blurCloseRef.current) {
      clearTimeout(blurCloseRef.current);
      blurCloseRef.current = null;
    }

    const display = s.formattedAddress || s.primaryText;
    selectedRef.current = true;
    setQuery(display);
    setOpen(false);
    setSuggestions([]);
    setHint(null);
    setSearchedEmpty(false);
    setPending(true);

    let lat = s.lat;
    let lng = s.lng;
    let formatted = s.formattedAddress || s.primaryText;

    if (lat == null || lng == null) {
      try {
        const res = await fetch(
          `/api/places/resolve?placeId=${encodeURIComponent(s.placeId)}&q=${encodeURIComponent(formatted)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            location?: {
              lat: number;
              lng: number;
              formattedAddress?: string;
            };
          };
          lat = data.location?.lat;
          lng = data.location?.lng;
          if (data.location?.formattedAddress) {
            formatted = data.location.formattedAddress;
            setQuery(formatted);
          }
        }
      } catch {
        /* fall through */
      }
    }

    setPending(false);

    if (
      lat == null ||
      lng == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      selectedRef.current = false;
      setHint("Couldn’t pin that place — try another suggestion.");
      setOpen(true);
      return;
    }

    const next: PlaceValue = {
      placeId: s.placeId,
      formattedAddress: formatted,
      label: formatted,
      lat,
      lng,
    };
    selectedRef.current = true;
    setJustPinned(true);
    window.setTimeout(() => setJustPinned(false), 1200);
    onChange(next);
    onPinned?.(next);
  };

  const clear = () => {
    selectedRef.current = false;
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    setHint(null);
    setSearchedEmpty(false);
    setPending(false);
    setJustPinned(false);
    onChange(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div
      className={`place-field${value ? " is-selected" : ""}${open ? " is-open" : ""}`}
    >
      <div className="place-field-head">
        <span className="place-label">{label}</span>
        {value ? (
          <button type="button" className="place-clear" onClick={clear}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="place-input-wrap">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-busy={pending}
          aria-describedby={hint && !value ? hintId : undefined}
          aria-activedescendant={
            open && suggestions[activeIndex]
              ? `${listId}-opt-${activeIndex}`
              : undefined
          }
          aria-label={label}
          autoFocus={autoFocus}
          enterKeyHint="search"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setJustPinned(false);
            if (selectedRef.current) {
              selectedRef.current = false;
              onChange(null);
            } else if (value) {
              onChange(null);
            }
            setHint(
              next.trim().length >= 2
                ? "Searching…"
                : next.trim().length > 0
                  ? "Keep typing…"
                  : null,
            );
            search(next);
          }}
          onBlur={() => {
            blurCloseRef.current = setTimeout(() => {
              setOpen(false);
              if (!selectedRef.current && query.trim()) {
                setHint("Pick an address from the list to pin it");
              }
            }, 180);
          }}
          onFocus={() => {
            if (blurCloseRef.current) {
              clearTimeout(blurCloseRef.current);
              blurCloseRef.current = null;
            }
            if (suggestions.length || searchedEmpty) setOpen(true);
            else if (query.trim().length >= 2 && !value) search(query);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              if (suggestions.length) setOpen(true);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!suggestions.length) return;
              setActiveIndex((i) => (i + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              if (!suggestions.length) return;
              setActiveIndex(
                (i) => (i - 1 + suggestions.length) % suggestions.length,
              );
              return;
            }
            if (e.key === "Enter") {
              const target = suggestions[activeIndex] || suggestions[0];
              if (open && target) {
                e.preventDefault();
                void pick(target);
              }
            }
          }}
          autoComplete="off"
          spellCheck={false}
        />
        {pending ? (
          <span className="place-pending" aria-hidden>
            <span className="place-spinner" />
          </span>
        ) : null}
      </div>
      {hint && !value ? (
        <p id={hintId} className="place-hint muted">
          {hint}
        </p>
      ) : null}
      {value ? (
        <p
          className={`place-confirmed muted${justPinned ? " is-fresh" : ""}`}
          title={`${value.lat}, ${value.lng}`}
          aria-live={justPinned ? "polite" : undefined}
        >
          <span className="place-pinned-dot" aria-hidden />
          Pinned
        </p>
      ) : null}
      {open && suggestions.length > 0 ? (
        <ul id={listId} role="listbox" className="place-suggestions">
          {suggestions.map((s, i) => (
            <li
              key={`${s.placeId}-${i}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? "is-active" : undefined}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => void pick(s)}
              >
                <strong>{s.primaryText}</strong>
                {s.secondaryText ? (
                  <span className="muted">{s.secondaryText}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && searchedEmpty && !pending ? (
        <div id={listId} role="status" className="place-suggestions">
          <p className="place-empty">
            No places found. Try a fuller address or airport code (JFK, LGA).
          </p>
        </div>
      ) : null}
    </div>
  );
});
