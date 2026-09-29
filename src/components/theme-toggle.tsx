"use client";

/**
 * Light, dark, or whatever the machine says.
 *
 * Three states rather than two. A binary switch has to pick a side the first
 * time someone loads the page, and picking wrong is worse than following the
 * system — which is what almost everyone wants and nobody should have to ask
 * for.
 *
 * The choice is written to `data-theme` on <html> and to localStorage. The
 * inline script in layout.tsx replays it before first paint; without that,
 * a dark-mode reader gets a white flash on every navigation, which is the
 * one thing dark mode exists to prevent.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { withTransition } from "@/lib/view-transition";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "ridelens.theme";

function readStored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    /* Private windows and blocked storage both land here. */
    return "system";
  }
}

/* Same-tab changes do not fire `storage`, so the toggle announces its own. */
const CHANGED = "ridelens:themechange";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/*
 * The browser chrome follows the choice, not only the OS.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `viewport.themeColor` in layout.tsx is keyed on                          │
 * │ `prefers-color-scheme` alone, and this function never touched the meta   │
 * │ tag. So a reader on a dark machine who picks **Light** got a porcelain   │
 * │ page under a #0d1511 chrome band — and with `appleWebApp.capable` that   │
 * │ band is the iOS standalone status bar, at the top of every screen. Two   │
 * │ of the six OS x choice combinations were visibly broken, and the         │
 * │ screenshot corpus only ever held the two *system* ones, so nothing could │
 * │ have caught it.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Read from the page rather than from a table: --ground is the thing the
 * chrome is supposed to match, so asking the computed style for it cannot
 * drift from whatever the stylesheet currently says. Applied by removing the
 * media-keyed tags, because a `<meta name="theme-color">` with a `media`
 * attribute that matches still wins over one without.
 */
function syncThemeColor(): void {
  const ground = getComputedStyle(document.documentElement).getPropertyValue("--ground").trim();
  if (!ground) return;
  const head = document.head;
  /*
   * One tag, chosen here rather than assumed.
   *
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ `viewport.themeColor` in layout.tsx is React-managed metadata, and   │
   * │ the inline script in <head> rewrites the content of the very tag     │
   * │ React rendered. React will not adopt a tag whose content it did not  │
   * │ write, so during hydration it appends its own copy — and on every    │
   * │ dark-resolving load the head ends up holding two media-less          │
   * │ theme-color tags: the script's #0d1511 and React's #f8f6f1 floor.    │
   * │ Sampled every 40ms, the duplicate appears at ~240ms and stays for    │
   * │ the rest of the page's life.                                         │
   * │                                                                      │
   * │ This loop removed only the media-keyed tags and then wrote to the    │
   * │ first survivor, which was already correct — so the stale one was     │
   * │ never anyone's to remove. Browsers honour the first, so the band     │
   * │ looked right while the DOM stayed wrong.                             │
   * └──────────────────────────────────────────────────────────────────────┘
   *
   * So: keep one owner, drop everything else claiming the name, write the
   * ground to it.
   */
  const tags = [...head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  let tag: HTMLMetaElement | null = tags.find((t) => !t.media) ?? tags[0] ?? null;
  for (const other of tags) if (other !== tag) other.remove();
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = "theme-color";
    head.appendChild(tag);
  }
  tag.content = ground;
}

export function applyTheme(choice: ThemeChoice): void {
  /*
   * The largest cut in the app, tweened.
   *
   * Flipping the scheme repaints every pixel — the ground, ten enclosures,
   * the map's basemap — and it did it as a hard swap. globals.css has styled
   * `::view-transition-old(root)` and `::view-transition-new(root)` all
   * along; the only thing ever calling `startViewTransition` was the re-sort,
   * so the rule was written for the change that needed it least.
   *
   * The attribute write stays synchronous inside the callback, so a browser
   * without view transitions and a reader who asked for less motion both get
   * exactly what they got before.
   */
  withTransition(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    syncThemeColor();
  });
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* The attribute is already set; persistence is the optional half. */
  }
  window.dispatchEvent(new Event(CHANGED));
}

const LABELS: Record<ThemeChoice, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

const ORDER: ThemeChoice[] = ["system", "light", "dark"];

export function ThemeToggle() {
  /* Server snapshot is "system": it is what an unstyled first paint gets. */
  const choice = useSyncExternalStore(subscribe, readStored, () => "system" as ThemeChoice);

  /*
   * On mount, and whenever the OS flips under a reader who chose "system".
   *
   * applyTheme only runs on a click, so a stored choice restored at load —
   * the common case — never reached the meta tag, and neither did the OS
   * changing at sunset while the toggle says Match system.
   */
  useEffect(() => {
    syncThemeColor();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onFlip = () => syncThemeColor();
    mq.addEventListener("change", onFlip);
    return () => mq.removeEventListener("change", onFlip);
  }, [choice]);

  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]!;
    applyTheme(next);
  }, [choice]);

  return (
    <button
      type="button"
      className="ghost theme-toggle"
      onClick={cycle}
      aria-label={`Colour scheme: ${LABELS[choice]}. Activate to change.`}
      title={LABELS[choice]}
    >
      <span aria-hidden className="theme-glyph" data-choice={choice}>
        {choice === "dark" ? "◑" : choice === "light" ? "○" : "◐"}
      </span>
      <span className="theme-label">{LABELS[choice]}</span>
    </button>
  );
}
