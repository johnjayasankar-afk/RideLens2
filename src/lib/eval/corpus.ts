/**
 * The ground truth, and where it is allowed to come from.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE RULE                                                             │
 * │                                                                          │
 * │ Ground truth may never be synthesised from the model. A corpus generated │
 * │ by the thing it is scoring produces perfect calibration and means        │
 * │ nothing, and it is an easy mistake to make by accident — the model is    │
 * │ right there and it produces plausible numbers on demand.                 │
 * │                                                                          │
 * │ Every record therefore carries its origin, and the report prints the mix.│
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ActualRecord } from "./metrics";

export type Origin =
  /** A rider told us what they paid, through the capture on the handoff. */
  | "reported"
  /** Someone followed docs/COLLECTION_PROTOCOL.md and recorded in-app quotes. */
  | "manual"
  /** Published aggregates — a distributional sanity check, not per-trip truth. */
  | "published";

export interface CorpusRecord extends ActualRecord {
  origin: Origin;
  /** Where this specific record came from, for auditability. */
  collectedVia: string;
  collectedOn: string;
}

export interface Corpus {
  records: CorpusRecord[];
  byOrigin: Record<Origin, number>;
  /** Anything that failed validation, with the reason. */
  rejected: Array<{ reason: string; raw: unknown }>;
}

const ORIGINS: Origin[] = ["reported", "manual", "published"];

function validate(
  raw: unknown,
): { ok: true; record: CorpusRecord } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not an object" };
  const r = raw as Record<string, unknown>;

  const nums = ["predictedMinMinor", "predictedMaxMinor", "actualMinor"] as const;
  for (const k of nums) {
    if (typeof r[k] !== "number" || !Number.isFinite(r[k])) {
      return { ok: false, reason: `${k} is not a finite number` };
    }
  }
  if ((r.predictedMaxMinor as number) < (r.predictedMinMinor as number)) {
    return { ok: false, reason: "band is inverted" };
  }
  if ((r.actualMinor as number) <= 0) return { ok: false, reason: "actual fare is not positive" };
  if (typeof r.provider !== "string" || !r.provider) return { ok: false, reason: "no provider" };
  if (typeof r.routeHash !== "string" || !r.routeHash) return { ok: false, reason: "no routeHash" };
  if (!ORIGINS.includes(r.origin as Origin)) {
    return { ok: false, reason: `origin must be one of ${ORIGINS.join(", ")}` };
  }
  if (typeof r.predictedAt !== "string" || Number.isNaN(Date.parse(r.predictedAt))) {
    return { ok: false, reason: "predictedAt is not a date" };
  }
  return { ok: true, record: r as unknown as CorpusRecord };
}

/**
 * Read a corpus file, keeping the rejects.
 *
 * A record that cannot be validated is reported rather than dropped: a corpus
 * that silently shrinks is a corpus whose sample size is a lie.
 */
export async function loadCorpus(file: string): Promise<Corpus> {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(abs, "utf8"));
  } catch (err) {
    return {
      records: [],
      byOrigin: { reported: 0, manual: 0, published: 0 },
      rejected: [{ reason: err instanceof Error ? err.message : "unreadable", raw: file }],
    };
  }

  const rows = Array.isArray(parsed) ? parsed : [];
  const records: CorpusRecord[] = [];
  const rejected: Corpus["rejected"] = [];
  for (const raw of rows) {
    const result = validate(raw);
    if (result.ok) records.push(result.record);
    else rejected.push({ reason: result.reason, raw });
  }

  const byOrigin: Record<Origin, number> = { reported: 0, manual: 0, published: 0 };
  for (const r of records) byOrigin[r.origin] += 1;

  return { records, byOrigin, rejected };
}

/**
 * Per-trip truth only.
 *
 * Published aggregates are a distributional sanity check and cannot be scored
 * against an individual prediction, so they are kept in the corpus for context
 * and excluded from coverage and bias.
 */
export function scorable(corpus: Corpus): CorpusRecord[] {
  return corpus.records.filter((r) => r.origin !== "published");
}
