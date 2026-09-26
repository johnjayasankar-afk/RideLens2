/**
 * The link preview for a shared comparison.
 *
 * The generic card says what RideLens is. This one says what *this*
 * comparison said — the route, the options, the prices somebody actually
 * saw. It is the difference between sharing a product and sharing a result.
 *
 * It carries the timestamp for the same reason the page does: a preview is
 * often all anybody reads, and a set of prices with no date on it reads as
 * current.
 */
import { ImageResponse } from "next/og";

import { formatQuotePrice } from "@/lib/domain/money";
import { rankQuotes } from "@/lib/domain/ranking";
import { getSession } from "@/lib/quotes/orchestrator";

export const alt = "A RideLens comparison";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0f1712";
const MUTED = "#48524c";

export default async function SessionOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);

  /* A dead or expired link still needs a card rather than a broken image. */
  if (!session) {
    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8f6f1",
          color: INK,
          fontSize: 44,
        }}
      >
        This comparison has expired
      </div>,
      size,
    );
  }

  const ranked = rankQuotes(session.quotes, session.rankingMode, "ALL").slice(0, 4);
  const from = session.pickup.formattedAddress.split(",")[0];
  const to = session.destination.formattedAddress.split(",")[0];
  const when = new Date(session.createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#f8f6f1",
        backgroundImage:
          "radial-gradient(900px 460px at 0% 0%, rgba(167,243,208,0.55), rgba(167,243,208,0) 60%)",
        color: INK,
        padding: "56px 64px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", fontSize: 22, color: MUTED, letterSpacing: 1 }}>
          RIDELENS
        </div>
        <div style={{ display: "flex", fontSize: 58, fontWeight: 600, letterSpacing: -1.5 }}>
          {from} → {to}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {ranked.map((q, i) => (
          <div
            key={q.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 22px",
              borderRadius: 16,
              backgroundColor: i === 0 ? "#dbf6e8" : "rgba(255,255,255,0.72)",
              fontSize: 30,
            }}
          >
            <div style={{ display: "flex", color: i === 0 ? "#13603e" : INK }}>
              {q.providerProductName}
            </div>
            <div
              style={{
                display: "flex",
                fontWeight: 600,
                color: i === 0 ? "#13603e" : INK,
              }}
            >
              {formatQuotePrice(q)}
            </div>
          </div>
        ))}
      </div>

      {/* A set of prices with no date on it reads as current. */}
      <div style={{ display: "flex", fontSize: 22, color: MUTED }}>
        Modeled estimates as they stood on {when} — not live quotes
      </div>
    </div>,
    size,
  );
}
