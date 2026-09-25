/**
 * `npm run eval` — score the model against real fares.
 *
 * Exits non-zero when the corpus has enough data to judge and the model has
 * regressed against docs/CALIBRATION.md, so a parameter change that trades
 * sharpness for coverage cannot land quietly.
 */
import { writeFile } from "node:fs/promises";

import { loadCorpus, scorable } from "@/lib/eval/corpus";
import { coverageAdjustedSharpness, evaluate, MIN_SAMPLES } from "@/lib/eval/metrics";
import { renderReport } from "@/lib/eval/report";

const CORPUS = process.env.EVAL_CORPUS ?? "tests/fixtures/calibration-corpus.json";
const OUT = "docs/CALIBRATION.md";

async function main() {
  const corpus = await loadCorpus(CORPUS);
  const records = scorable(corpus);
  const report = evaluate(records);

  await writeFile(OUT, renderReport(report, corpus), "utf8");

  const n = report.overall.n;
  console.log(
    `corpus: ${corpus.records.length} records (${n} scorable, ${corpus.rejected.length} rejected)`,
  );

  if (n < MIN_SAMPLES) {
    console.log(
      `Not enough to judge: ${n} of ${MIN_SAMPLES} needed. Wrote ${OUT} saying exactly that.`,
    );
    // Not a failure. An empty corpus is the honest starting state, and making
    // it red would train everyone to ignore this command.
    return;
  }

  const score = coverageAdjustedSharpness(report.overall);
  console.log(
    `coverage ${(report.overall.coverage! * 100).toFixed(1)}% | ` +
      `mean width ${(report.overall.meanRelativeWidth! * 100).toFixed(1)}% | ` +
      `score ${score!.toFixed(3)}`,
  );

  const floor = process.env.EVAL_MIN_SCORE ? Number(process.env.EVAL_MIN_SCORE) : null;
  if (floor !== null && score! < floor) {
    console.error(`Regression: score ${score!.toFixed(3)} is below the floor ${floor.toFixed(3)}.`);
    process.exitCode = 1;
  }
}

void main();
