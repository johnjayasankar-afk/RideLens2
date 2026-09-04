import { ImageResponse } from "next/og";

export const alt = "RideLens — Every ride. One comparison.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#070a0e",
          color: "#eef2f6",
          padding: "64px 72px",
          backgroundImage:
            "radial-gradient(900px 420px at 8% -10%, rgba(62,207,142,0.22), transparent 55%), radial-gradient(700px 380px at 100% 0%, rgba(107,155,255,0.16), transparent 50%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                background: "#3ecf8e",
              }}
            />
            <div
              style={{
                width: 28,
                height: 3,
                borderRadius: 999,
                background: "#eef2f6",
              }}
            />
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                background: "#6b9bff",
              }}
            />
          </div>
          <div style={{ fontSize: 34, letterSpacing: -0.8, fontWeight: 600 }}>
            RideLens
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 940,
          }}
        >
          <div style={{ fontSize: 68, lineHeight: 1.05, letterSpacing: -1.6 }}>
            Every ride. One comparison.
          </div>
          <div style={{ fontSize: 28, color: "#8b96a5", maxWidth: 780 }}>
            Live routing and tight estimates for Uber, Lyft, Empower, and Curb —
            before you book.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 22,
            color: "#8b96a5",
          }}
        >
          <div>JFK → Times Square · side by side</div>
          <div>ridelens.app</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
