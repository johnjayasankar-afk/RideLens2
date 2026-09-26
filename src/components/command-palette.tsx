"use client";

/**
 * Everything the page can do, one keystroke away.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The controls were spread across three regions: ranking and filters above │
 * │ the results, swap and clear beside the form, theme in the topbar, and    │
 * │ the trips you actually take nowhere at all until the log existed.        │
 * │ Somebody comparing the same airport run twice a week was doing four      │
 * │ taps of navigation to reach a two-tap task.                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⌘K gathers them. It is not a search box over content — there is no content
 * to search — it is the command surface, and it earns its place by putting
 * the trip log first: the thing you are most likely to want is the trip you
 * ran yesterday.
 *
 * ── The accessibility shape ────────────────────────────────────────────────
 *
 * The combobox pattern, not a roving tabindex. Focus stays in the input and
 * `aria-activedescendant` names the highlighted option, which is what screen
 * readers expect from a filter-as-you-type list and what keeps the typed
 * query audible while the selection moves. Escape closes and focus returns to
 * wherever it came from, because losing your place is the thing a keyboard
 * user notices first.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/* Nothing ever changes, so the subscription is a no-op teardown. */
const NO_SUBSCRIPTION = () => () => {};

import { usePrefersReducedMotion } from "@/components/use-count-up";

export interface Command {
  id: string;
  label: string;
  /** Shown right-aligned: a shortcut, a count, a current value. */
  hint?: string;
  group: string;
  /** Extra words to match on that are not worth showing. */
  keywords?: string;
  run: () => void;
  disabled?: boolean;
}

/** Groups appear in this order; anything unlisted sorts after. */
const GROUP_ORDER = ["Your trips", "Go", "Rank by", "Show", "Appearance", "Actions"];

function groupRank(group: string): number {
  const i = GROUP_ORDER.indexOf(group);
  return i === -1 ? GROUP_ORDER.length : i;
}

/**
 * Match every word of the query somewhere in the command.
 *
 * Deliberately not fuzzy. A fuzzy matcher on a list this small mostly
 * produces surprising near-misses, and "jfk" matching "JFK Airport" is the
 * whole requirement.
 */
function score(command: Command, query: string): number | null {
  if (!query) return 0;
  const haystack = `${command.label} ${command.group} ${command.keywords ?? ""}`.toLowerCase();
  let best = Infinity;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = haystack.indexOf(word);
    if (at === -1) return null;
    best = Math.min(best, at);
  }
  return best === Infinity ? 0 : best;
}

/**
 * Owns ⌘K, and the command list itself.
 *
 * The list is built when the palette opens, not during render. Every `run` is
 * an event handler that reaches the abort controllers and generation counters
 * the form keeps in refs, and an array of those assembled during render is
 * render-time ref access however it is spelled — the compiler is right about
 * that. Opening is an event, so the list is built there.
 *
 * `getCommands` changes identity every render, so it is held in a ref that an
 * effect keeps current; the keydown listener is registered once and reads the
 * latest through it.
 */
export function useCommandPalette(getCommands: () => Command[]): {
  open: boolean;
  /**
   * Whether the shortcut is actually live.
   *
   * The listener is registered on mount, so the server-rendered page
   * advertised ⌘K before anything could answer it — and on a slow machine
   * that window is long enough to press it in and get nothing. The hint is
   * rendered from this rather than unconditionally.
   *
   * Read through useSyncExternalStore rather than an effect that sets state:
   * the server snapshot is false, the client's is true, and nothing has to
   * write during a render or in an effect body to say so.
   */
  ready: boolean;
  commands: Command[];
  close: () => void;
  openWith: () => void;
} {
  const [open, setOpen] = useState(false);
  const ready = useSyncExternalStore(
    NO_SUBSCRIPTION,
    () => true,
    () => false,
  );
  const [commands, setCommands] = useState<Command[]>([]);
  const latest = useRef(getCommands);

  /* Writing a ref in an effect body is the sanctioned place for it. */
  useEffect(() => {
    latest.current = getCommands;
  });

  const openWith = useCallback(() => {
    setCommands(latest.current());
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((wasOpen) => {
          if (!wasOpen) setCommands(latest.current());
          return !wasOpen;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, ready, commands, close, openWith };
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();

  const matches = useMemo(() => {
    const scored = commands
      .filter((c) => !c.disabled)
      .map((c) => ({ c, s: score(c, query) }))
      .filter((x): x is { c: Command; s: number } => x.s !== null);
    scored.sort((a, b) => groupRank(a.c.group) - groupRank(b.c.group) || a.s - b.s);
    return scored.map((x) => x.c);
  }, [commands, query]);

  /* Clamped rather than reset, so filtering does not silently select a
     different command than the one under the highlight. */
  const activeIndex = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);
  const activeId = activeIndex >= 0 ? `cmd-${matches[activeIndex].id}` : undefined;

  /* Opening is a DOM side effect, not derived state: remember where focus
     was, then take it. */
  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      returnFocusTo.current?.focus?.();
    };
  }, [open]);

  const close = useCallback(() => {
    setQuery("");
    setActive(0);
    onClose();
  }, [onClose]);

  const choose = useCallback(
    (command: Command) => {
      close();
      /* After the close, so a command that moves focus wins over the
         restore above. */
      command.run();
    },
    [close],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setActive((i) =>
        matches.length === 0 ? 0 : (Math.min(i, matches.length - 1) + 1) % matches.length,
      );
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setActive((i) =>
        matches.length === 0
          ? 0
          : (Math.min(i, matches.length - 1) + matches.length - 1) % matches.length,
      );
      return;
    }
    if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      choose(matches[activeIndex]);
    }
  };

  /* Keep the highlight in view without moving focus. */
  useEffect(() => {
    if (!open || !activeId) return;
    /* Group headers are rows too, so the option is found by id rather than
       by counting children. */
    const el = document.getElementById(activeId);
    el?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [open, activeId, reduced]);

  if (!open) return null;

  return (
    <div
      className="cmdk-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Commands">
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Type a command"
          placeholder="Search trips, filters and actions…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="cmdk-list" id="cmdk-list" role="listbox" aria-label="Commands" ref={listRef}>
          {matches.map((c, i) => {
            /* Derived from the row above rather than carried in a variable
               that outlives the render it belongs to. */
            const head = i === 0 || matches[i - 1].group !== c.group ? c.group : null;
            return (
              <Fragment key={c.id}>
                {/* A separate row, not a span inside the option: inside, the
                    highlight swallowed it and its text joined the option's
                    accessible name — "Your trips 14 Prince St → JFK". */}
                {head ? (
                  <li className="cmdk-group" role="presentation">
                    {head}
                  </li>
                ) : null}
                <li
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`cmdk-item${i === activeIndex ? " is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(c)}
                >
                  <span className="cmdk-label">{c.label}</span>
                  {c.hint ? <span className="cmdk-hint muted">{c.hint}</span> : null}
                </li>
              </Fragment>
            );
          })}
          {matches.length === 0 ? (
            <li
              className="cmdk-empty muted"
              role="option"
              aria-selected="false"
              aria-disabled="true"
            >
              Nothing matches “{query}”
            </li>
          ) : null}
        </ul>
        <p className="cmdk-foot muted fine">
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> to move · <kbd className="kbd">↵</kbd> to run ·{" "}
          <kbd className="kbd">esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
