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

import { useCallback, useSyncExternalStore } from "react";

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

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
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
