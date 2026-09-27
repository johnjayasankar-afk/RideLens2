/**
 * Does every parameter actually do something?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `model-params.ts` says of itself that changing any value there means     │
 * │ bumping MODEL_VERSION, re-running `npm run eval`, and refusing the       │
 * │ change if sharpness regressed. Eleven of its fields were read    │
 * │ nowhere at all. Tuning one of them changed no fare, produced no eval     │
 * │ movement, and looked exactly like a model that was insensitive to it.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A first pass by hand found nine; this test found two more, which is the
 * argument for having it at all.
 *
 * `baseRelativeHalfWidth` was the clearest case: its value, 0.035, was also
 * written as a literal cap inside `uncertaintyBand`. Two copies of one
 * number, one of them inert. It is wired now, and the model snapshot proved
 * the wiring moved no fare.
 *
 * The rest are listed below rather than quietly deleted, because each one
 * records a real modelling intention and removing it would lose that. What
 * they must not do is masquerade as live configuration, so they are named
 * here and in the file itself.
 *
 * The list is exact in both directions: a new unwired parameter fails this
 * test, and so does wiring one without striking it off.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PARAMS_FILE = "src/lib/sources/ratecard/model-params.ts";

/**
 * Declared, deliberate, and not yet wired to anything.
 *
 * Each is a number somebody wrote down about how the marketplace behaves,
 * kept because the intention is worth keeping. None of them currently
 * changes a fare. Wiring one is a modelling decision with a version bump
 * attached — not a tidy-up.
 */
const KNOWN_UNWIRED = new Set([
  /* Traffic multipliers. `trafficDurationFactor` has its own curve. */
  "morningPeak",
  "eveningPeak",
  "weekendDay",
  /* Demand lifts. `todDemandLift` builds its own from Gaussians. */
  "lunchLift",
  "afternoonLift",
  "nightLift",
  "nightlifeHeat",
  /* Zone heat. `zoneHeat` carries its own airport and core weights. */
  "airportHeat",
  "coreHeat",
  /* Weather ceiling. `weather-signal.ts` applies its own. */
  "maxLift",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const paramsSource = readFileSync(PARAMS_FILE, "utf8");

/** Field names from the interface declarations, not the values. */
const declared = [...paramsSource.matchAll(/^\s{2,}([a-zA-Z][a-zA-Z0-9_]*)\??:/gm)]
  .map((m) => m[1])
  .filter((name) => name !== "version");

/* The interface and the object literal both declare each name. */
const declaredOnce = [...new Set(declared)];

const elsewhere = sourceFiles("src")
  .filter((f) => !f.endsWith("model-params.ts"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

function isRead(name: string): boolean {
  /* A word-boundary match: `.lunchLift` and `{ lunchLift }` both count. */
  return new RegExp(`\\b${name}\\b`).test(elsewhere);
}

describe("model parameters", () => {
  it("declares some", () => {
    expect(declaredOnce.length).toBeGreaterThan(20);
  });

  it("wires every parameter that is not knowingly unwired", () => {
    const deadAndUnlisted = declaredOnce.filter((n) => !isRead(n) && !KNOWN_UNWIRED.has(n));
    expect(
      deadAndUnlisted,
      deadAndUnlisted.length === 0
        ? ""
        : `\n\nThese MODEL_PARAMS fields are read nowhere, so changing them changes nothing:\n` +
            deadAndUnlisted.map((n) => `  ${n}`).join("\n") +
            `\n\nEither wire one up, or add it to KNOWN_UNWIRED with the reason. A parameter` +
            ` that cannot move a fare must not look like one that can.\n`,
    ).toEqual([]);
  });

  /*
   * The other direction, so the list cannot rot. Wiring a parameter is good
   * news; leaving it on a list of dead ones afterwards is how the list stops
   * being trustworthy.
   */
  it("keeps the unwired list honest", () => {
    const nowWired = [...KNOWN_UNWIRED].filter((n) => isRead(n));
    expect(
      nowWired,
      nowWired.length === 0
        ? ""
        : `\n\nThese are listed as unwired but something reads them now:\n` +
            nowWired.map((n) => `  ${n}`).join("\n") +
            `\n\nStrike them off KNOWN_UNWIRED.\n`,
    ).toEqual([]);
  });

  /* The one that was two copies of a number, only one of which did anything. */
  it("reads the band half-width from the parameters rather than a literal", () => {
    const engine = readFileSync("src/lib/sources/ratecard/fare-engine.ts", "utf8");
    expect(engine).toContain("MODEL_PARAMS.band.baseRelativeHalfWidth");
  });
});
