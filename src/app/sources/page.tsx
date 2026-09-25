import type { Metadata } from "next";
import Link from "next/link";

import { MARKET_COVERAGE, MODELLED_MARKETS } from "@/lib/domain/market-coverage";
import type { ProviderId } from "@/lib/domain/types";
import { getEnv } from "@/lib/config";
import { sourceStatusSummary } from "@/lib/sources/registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sources",
  description:
    "Every source behind a RideLens number: what feeds it, whether comparison is contractually permitted, and whether it is switched on right now.",
};

/**
 * Where the numbers come from.
 *
 * Built from live configuration rather than rendered from
 * docs/DATA_SOURCE_MATRIX.md. The document records what is *permitted*, which
 * changes when a contract does; this page also has to say what is *running*,
 * which changes when an environment variable does. A page that could claim a
 * source was enabled when it was not would be the same class of untruth the
 * provenance chip exists to prevent.
 */

type Status = "enabled" | "partner_approval" | "comparison_restricted" | "disabled" | "other";

function classify(raw: string): Status {
  if (raw.startsWith("enabled")) return "enabled";
  if (raw === "partner_approval") return "partner_approval";
  if (raw === "comparison_restricted") return "comparison_restricted";
  if (raw === "disabled") return "disabled";
  return "other";
}

const STATUS_COPY: Record<Status, { label: string; tone: string }> = {
  enabled: { label: "Answering now", tone: "mint" },
  partner_approval: { label: "Needs partner approval", tone: "amber" },
  comparison_restricted: { label: "Comparison not permitted", tone: "rose" },
  disabled: { label: "Switched off", tone: "muted" },
  other: { label: "Misconfigured", tone: "rose" },
};

interface SourceRow {
  id: string;
  name: string;
  feeds: string;
  permitted: string;
  /** Why it is not on, when it is not — the honest version. */
  blocker?: string;
}

/**
 * The legal position, from docs/DATA_SOURCE_MATRIX.md (verified 2026-09-03).
 * Re-verify there before changing anything here.
 */
const SOURCES: SourceRow[] = [
  {
    id: "public_rate_card",
    name: "Published rate cards",
    feeds:
      "A live OSRM route, the city's published tariff, the regulatory fee stack, tolls along the line, a live Open-Meteo precipitation signal, and a deterministic simulation of marketplace behaviour.",
    permitted: "Public data. No permission required.",
  },
  {
    id: "obi",
    name: "Obi FARE.AI",
    feeds:
      "Licensed market percentiles (p25–p75) for Uber, Lyft, Curb and others — what trips like this have recently cost across the market.",
    permitted: "Permitted under an Obi licence. Their consumer app is never scraped.",
    blocker: "Needs OBI_API_KEY and OBI_API_SECRET.",
  },
  {
    id: "uber",
    name: "Uber Price Estimates API",
    feeds: "Uber's own estimate endpoint.",
    permitted:
      "Not permitted for comparison under the public API terms (§ II B) without written authorization.",
    blocker: "Disabled for comparison by default, and stays that way absent written authorization.",
  },
  {
    id: "lyft",
    name: "Lyft /v1/cost",
    feeds: "Lyft's own cost and ETA endpoints.",
    permitted: "Commercially unclear; gated behind an explicit authorization flag.",
    blocker: "Needs LYFT_COMPARISON_AUTHORIZED plus client credentials.",
  },
  {
    id: "curb",
    name: "Curb partner API",
    feeds: "Curb Business quotes, upfront where the API says so.",
    permitted: "Permitted if the partner contract allows it.",
    blocker: "Needs CURB_API_KEY and CURB_API_BASE_URL.",
  },
  {
    id: "empower",
    name: "Empower partner API",
    feeds: "Empower's own estimates.",
    permitted: "Permitted if the partner contract allows it.",
    blocker: "Needs EMPOWER_API_KEY and EMPOWER_API_BASE_URL.",
  },
];

export default function SourcesPage() {
  const env = getEnv();
  const summary = sourceStatusSummary(env) as Record<string, string>;
  const liveCount = Object.values(summary).filter((v) => String(v).startsWith("enabled")).length;

  const coverage = (["uber", "lyft", "curb", "empower"] as ProviderId[]).map((provider) => {
    const markets = Object.entries(MARKET_COVERAGE[provider] ?? {}).filter(
      ([, entry]) => entry?.status === "OPERATES",
    );
    return { provider, count: markets.length, entries: markets };
  });

  return (
    <div className="shell sources-page">
      <p className="eyebrow">Sources</p>
      <h1 className="brand">Where every number comes from</h1>
      <p className="sources-lede">
        RideLens shows what it can stand behind and says what it cannot. Right now{" "}
        <strong>
          {liveCount} of {Object.keys(summary).length}
        </strong>{" "}
        sources are answering. Everything else is listed with the specific reason it is not.
      </p>

      <section aria-labelledby="feeds">
        <h2 id="feeds">Quote sources</h2>
        <ul className="sources-list">
          {SOURCES.map((s) => {
            const status = classify(String(summary[s.id] ?? "disabled"));
            const copy = STATUS_COPY[status];
            return (
              <li key={s.id} className="source-row">
                <div className="source-head">
                  <h3>{s.name}</h3>
                  <span className={`source-status is-${copy.tone}`}>{copy.label}</span>
                </div>
                <p className="source-feeds">{s.feeds}</p>
                <dl className="source-meta">
                  <div>
                    <dt>Comparison permitted?</dt>
                    <dd>{s.permitted}</dd>
                  </div>
                  {status !== "enabled" && s.blocker ? (
                    <div>
                      <dt>Why it is not on</dt>
                      <dd>{s.blocker}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="coverage">
        <h2 id="coverage">Where each provider is shown</h2>
        <p className="sources-note">
          A provider appears in a comparison only where its coverage has been confirmed. Anywhere
          else it is left out and named, because &ldquo;we checked and it is not here&rdquo; and
          &ldquo;we have not checked&rdquo; are different sentences. Of {MODELLED_MARKETS.length}{" "}
          modelled markets:
        </p>
        <ul className="coverage-list">
          {coverage.map(({ provider, count }) => (
            <li key={provider}>
              <strong>{provider}</strong>
              <span>
                {count === 0
                  ? "no confirmed market — not shown anywhere"
                  : count >= MODELLED_MARKETS.length
                    ? "every modelled market"
                    : `${count} confirmed market${count === 1 ? "" : "s"}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="never">
        <h2 id="never">What RideLens will never claim</h2>
        <ol className="sources-never">
          <li>That a modeled number is a live provider quote.</li>
          <li>That a range has a single price, by showing its midpoint.</li>
          <li>That one option is cheaper than another when their bands overlap.</li>
          <li>That a fare is final. The provider&rsquo;s app is where a fare becomes real.</li>
          <li>
            That a provider is unavailable when the truth is that RideLens lacks a credential.
          </li>
          <li>That a personalised price applies to anyone else.</li>
        </ol>
      </section>

      <p className="sources-foot">
        <Link href="/">Back to the comparison</Link>
      </p>
    </div>
  );
}
