"use client";

/**
 * Which panel of the deck is open, kept in the URL.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The deck held this in its own state, which made it a thing only the deck │
 * │ could change. Three other places want to: the command palette, the       │
 * │ assistant, and a link somebody was sent. Passing a setter down through   │
 * │ two components would have served the first two and not the third.        │
 * │                                                                          │
 * │ The URL already carries the route, the ranking and the filter — every    │
 * │ other piece of "what am I looking at" in this product. This is one more, │
 * │ and putting it there answers all three at once: a shared link opens on   │
 * │ the panel the sender was reading, and a reload keeps your place.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Shaped after `applyTheme`: a module-level function anything may call, and a
 * hook for whatever needs to follow it. `replaceState` rather than `pushState`
 * on purpose — a tab is not a page, and stacking eight of them into the back
 * button would make Back mean "the panel before this one" for the rest of the
 * session.
 */

import { useSyncExternalStore } from "react";

const PARAM = "panel";
const EVENT = "ridelens:panel";

/**
 * Every panel opened this page load.
 *
 * Module-level, so it survives the deck re-rendering and is readable during
 * render without a ref. It only ever grows, and only when the active panel
 * changes — which is also what re-renders the deck, so a render never sees a
 * stale copy of it.
 */
const visited = new Set<string>();

function currentFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get(PARAM);
  return value && /^[a-z]{2,16}$/.test(value) ? value : null;
}

function subscribe(onChange: () => void): () => void {
  /* Recorded before React is told, so the render that follows already sees
     it. Back and forward reach panels `openPanel` never touched. */
  const handler = () => {
    const id = currentFromUrl();
    if (id) visited.add(id);
    onChange();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("popstate", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("popstate", handler);
  };
}

/* A link that arrived pointing at a panel has already opened it. */
if (typeof window !== "undefined") {
  const initial = currentFromUrl();
  if (initial) visited.add(initial);
}

/** Open a panel from anywhere: the deck, the palette, the assistant. */
export function openPanel(id: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, id);
  window.history.replaceState({}, "", url.toString());
  visited.add(id);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * The open panel, and every panel opened so far.
 *
 * `fallback` is what an untouched URL means, and what the server renders. A
 * client snapshot that differs is exactly the case `useSyncExternalStore` is
 * built for; it re-renders rather than warning about it.
 */
export function usePanel(fallback: string): { active: string; opened: ReadonlySet<string> } {
  const active =
    useSyncExternalStore(
      subscribe,
      () => currentFromUrl(),
      () => null,
    ) ?? fallback;
  visited.add(active);
  return { active, opened: visited };
}
