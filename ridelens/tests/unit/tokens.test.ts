/**
 * Every design token a component reaches for must actually exist.
 *
 * This is here because of a real defect. `FilterBar` styled its pills with
 * `var(--text-secondary)`, `var(--text-tertiary)` and `var(--surface-raised)`.
 * The palette calls those `--text-2`, `--text-3` and `--surface`. CSS does not
 * warn about an undefined custom property — the declaration is simply invalid
 * at computed-value time and the property inherits instead, so the filter row
 * quietly took its parent's colour and its "raised" background was transparent.
 *
 * It survived a long time because it looked like a design choice rather than a
 * bug. A typo in a token name should fail a test, not ship as a vibe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');

/** Names on the left of a `--x:` declaration anywhere in the stylesheet. */
function definedTokens(): Set<string> {
  const found = new Set<string>();
  for (const m of CSS.matchAll(/(--[a-z0-9-]+)\s*:/g)) found.add(m[1]!);
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('design tokens', () => {
  const defined = definedTokens();

  it('defines every token referenced from a component', () => {
    const missing: string[] = [];
    for (const file of [
      ...sourceFiles(path.join(ROOT, 'src/ui')),
      ...sourceFiles(path.join(ROOT, 'src/app')),
    ]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = m[1]!;
        if (!defined.has(name)) missing.push(`${path.relative(ROOT, file)} → ${name}`);
      }
    }
    expect(missing, `undefined CSS variables:\n${missing.join('\n')}`).toEqual([]);
  });

  it('also defines every token the stylesheet itself references', () => {
    const missing: string[] = [];
    for (const m of CSS.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const name = m[1]!;
      if (!defined.has(name)) missing.push(name);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('keeps every spacing value on the scale', () => {
    /**
     * Layout spacing comes from `--sp-*`, not from whatever number looked right
     * at the time. Before this the components used 3, 5, 6, 7, 9, 10, 11, 14
     * and 18 px alongside the scale — sixty values off-grid, each individually
     * defensible and collectively the reason the interface read as almost
     * aligned rather than aligned.
     *
     * Zero needs no token, and a negative value is an optical correction — a
     * control pulled back onto a line it would otherwise sit below — which is
     * deliberate and not spacing.
     */
    const PROPS =
      '(?:gap|rowGap|columnGap|padding|paddingTop|paddingBottom|paddingLeft|paddingRight' +
      '|paddingBlock|paddingInline|margin|marginTop|marginBottom|marginLeft|marginRight)';
    const offending: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src/ui'))) {
      const text = fs.readFileSync(file, 'utf8');
      const re = new RegExp(`${PROPS}:\\s*([1-9]\\d*)(?![\\d.a-zA-Z])`, 'g');
      for (const m of text.matchAll(re)) {
        offending.push(`${path.relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offending, `spacing off the --sp-* scale:\n${offending.join('\n')}`).toEqual([]);
  });

  it('uses the radius tokens rather than raw pixel values', () => {
    const offending: string[] = [];
    for (const file of sourceFiles(path.join(ROOT, 'src/ui'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/borderRadius:\s*(\d+)/g)) {
        offending.push(`${path.relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offending, `raw border radii:\n${offending.join('\n')}`).toEqual([]);
  });

  it('carries every palette token into the dark scheme', () => {
    // A colour defined only for light leaves dark mode with the light value,
    // which is how a "dark" page ends up with one stubbornly bright element.
    const darkBlock = CSS.split('@media (prefers-color-scheme: dark)')[1] ?? '';
    const COLOUR_PREFIXES = ['--text', '--surface', '--border', '--best', '--warn', '--danger'];
    const lightColours = [...CSS.matchAll(/^\s{2}(--[a-z0-9-]+)\s*:/gm)]
      .map((m) => m[1]!)
      .filter((n) => COLOUR_PREFIXES.some((p) => n.startsWith(p)));
    const missing = lightColours.filter((n) => !darkBlock.includes(`${n}:`));
    expect(missing, `not redefined for dark: ${missing.join(', ')}`).toEqual([]);
  });
});
