/**
 * Text has to be readable, and that is arithmetic rather than taste.
 *
 * Every text colour in the palette is checked against every surface it can
 * appear on, in both schemes, at the WCAG AA minimum of 4.5:1. This is not
 * hypothetical: `--text-4` shipped at 2.75:1 against the page in light mode and
 * 3.36:1 against a card in dark, carrying the tagline, the field labels and the
 * status legend. axe-core found it in the browser; this finds it in a
 * millisecond, and stops the palette drifting back.
 *
 * The ratios are computed from `globals.css` itself, so a token cannot be
 * changed without this recomputing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = fs.readFileSync(path.resolve(__dirname, '../../src/app/globals.css'), 'utf8');

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Token values for one scheme. `light` reads the `:root` block; `dark` reads
 * the media block layered over it, so a token the dark scheme does not
 * redefine keeps its light value — which is exactly how a stubbornly bright
 * element ends up on a dark page.
 */
function tokens(scheme: 'light' | 'dark'): Map<string, string> {
  const [rootBlock, darkBlock] = CSS.split('@media (prefers-color-scheme: dark)');
  const source = scheme === 'light' ? (rootBlock ?? '') : `${rootBlock ?? ''}${darkBlock ?? ''}`;
  const raw = new Map<string, string>();
  for (const m of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    raw.set(m[1]!, m[2]!.trim());
  }
  // Resolve var() aliases like `--text-3: var(--n-500)`.
  const resolve = (value: string, depth = 0): string => {
    if (depth > 8) return value;
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!alias) return value;
    const next = raw.get(alias[1]!);
    return next ? resolve(next.trim(), depth + 1) : value;
  };
  const out = new Map<string, string>();
  for (const [k, v] of raw) {
    const resolved = resolve(v);
    if (/^#[0-9a-f]{6}$/i.test(resolved)) out.set(k, resolved);
  }
  return out;
}

/** The page background is not a token — it is set on `body`. */
const PAGE = { light: '#f6f8fa', dark: '#0a0d12' };

const TEXT_TOKENS = ['--text', '--text-2', '--text-3', '--text-4'];
const SURFACE_TOKENS = ['--surface', '--surface-2', '--surface-sunken'];

const AA = 4.5;

describe('colour contrast', () => {
  for (const scheme of ['light', 'dark'] as const) {
    describe(scheme, () => {
      const t = tokens(scheme);

      it('every text colour clears AA on every surface it can sit on', () => {
        const failures: string[] = [];
        const backgrounds = [
          ['page', PAGE[scheme]] as const,
          ...SURFACE_TOKENS.map((s) => [s, t.get(s)!] as const),
        ];
        for (const name of TEXT_TOKENS) {
          const fg = t.get(name);
          expect(fg, `${name} is not defined for ${scheme}`).toBeDefined();
          for (const [bgName, bg] of backgrounds) {
            if (!bg) continue;
            const ratio = contrast(fg!, bg);
            if (ratio < AA) {
              failures.push(
                `${scheme}: ${name} (${fg}) on ${bgName} (${bg}) = ${ratio.toFixed(2)}:1`,
              );
            }
          }
        }
        expect(failures, failures.join('\n')).toEqual([]);
      });

      it('inverse text clears AA on the inverse surface', () => {
        // The primary button: white on near-black, or the reverse in dark mode.
        const fg = t.get('--on-inverse');
        const bg = t.get('--surface-inverse');
        expect(fg && bg).toBeTruthy();
        expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(AA);
      });

      it('semantic colours are legible on their own soft background', () => {
        const failures: string[] = [];
        for (const key of ['best', 'warn', 'danger']) {
          const fg = t.get(`--${key}`);
          const bg = t.get(`--${key}-soft`);
          if (!fg || !bg) continue;
          const ratio = contrast(fg, bg);
          if (ratio < AA) {
            failures.push(`${scheme}: --${key} on --${key}-soft = ${ratio.toFixed(2)}:1`);
          }
        }
        expect(failures, failures.join('\n')).toEqual([]);
      });

      it('keeps a visible step between the muted text levels', () => {
        // Passing AA is not enough on its own: three levels that all clear the
        // bar but look identical are one level wearing three names.
        const page = PAGE[scheme];
        const ratios = TEXT_TOKENS.map((n) => contrast(t.get(n)!, page));
        for (let i = 1; i < ratios.length; i += 1) {
          expect(
            ratios[i - 1]! - ratios[i]!,
            `${TEXT_TOKENS[i - 1]} and ${TEXT_TOKENS[i]} are indistinguishable in ${scheme}`,
          ).toBeGreaterThan(0.35);
        }
      });
    });
  }
});
