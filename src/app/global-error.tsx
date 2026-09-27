"use client";

/**
 * The last thing standing.
 *
 * `error.tsx` catches a page that throws, but it renders *inside* the root
 * layout — so if the layout itself throws, nothing catches it and the reader
 * gets a blank white document with no way back. This replaces the whole
 * document instead, which is why it has to carry its own <html> and <body>.
 *
 * It uses no classes, no tokens and no fonts. Everything it needs is inline,
 * because the stylesheet lives in the layout that just failed and assuming
 * otherwise is how a fallback ends up as unstyled text on white. `style-src`
 * allows inline styles — see proxy.ts — and this is exactly the case that
 * allowance exists for.
 *
 * The digest is shown deliberately. It is a hash, not a message, so it leaks
 * nothing, and it is the only thing that lets somebody reporting a blank page
 * be matched to the server log that explains it.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8f6f1",
          color: "#0f1712",
          font: "16px/1.55 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "36rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.6rem", margin: "0 0 12px", letterSpacing: "-0.02em" }}>
            RideLens could not load
          </h1>
          <p style={{ margin: "0 0 20px", color: "#48524c" }}>
            Something failed before the page could be built. Nothing was sent anywhere and no
            comparison was run.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 22px",
              border: 0,
              borderRadius: "999px",
              background: "#2c5a42",
              color: "#ffffff",
              font: "inherit",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ margin: "20px 0 0", fontSize: "12px", color: "#5f6862" }}>
              If you report this, quote{" "}
              <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{error.digest}</code>.
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
