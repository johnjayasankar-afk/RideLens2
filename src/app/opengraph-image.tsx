import { ImageResponse } from "next/og";

export const alt = "RideLens · Every ride. One comparison.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link-preview card in the Labs family look: porcelain ground, forest ink, a mint signal.
export default function OpenGraphImage() {
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
          "radial-gradient(900px 460px at 0% 0%, rgba(167,243,208,0.55), rgba(167,243,208,0) 60%), radial-gradient(700px 420px at 100% 100%, rgba(226,237,250,0.95), rgba(226,237,250,0) 60%)",
        color: "#0f1712",
        padding: "64px 72px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: 48,
            height: 48,
            padding: "0 9px",
            borderRadius: 14,
            background: "#1f4a35",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "#6ee7b7",
            }}
          />
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "#f0f7f3",
            }}
          />
        </div>
        <div style={{ fontSize: 36, letterSpacing: -1, fontWeight: 600 }}>RideLens</div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 980,
        }}
      >
        <div style={{ fontSize: 80, lineHeight: 1.02, letterSpacing: -3.4 }}>
          Every ride. One comparison.
        </div>
        <div
          style={{
            fontSize: 30,
            lineHeight: 1.35,
            color: "#48524c",
            maxWidth: 860,
          }}
        >
          Live roads and published rate cards for Uber, Lyft, Empower, and Curb, ranked before you
          book.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 22,
          color: "#5f6862",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: "#34d399",
            }}
          />
          <div>Price · Soonest · Value</div>
        </div>
        <div>labs.johnjayasankar.com/ridelens</div>
      </div>
    </div>,
    { ...size },
  );
}
