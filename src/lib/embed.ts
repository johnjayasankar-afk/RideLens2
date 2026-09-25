/**
 * Who may put this app in an iframe, and how it tells them it rendered.
 *
 * johnjayasankar.com shows a live preview of this product inside its case
 * study. That only works if the response allows that origin to frame it.
 *
 * Two headers decide it, and they do not agree. An enforced CSP with
 * `frame-ancestors` wins over `X-Frame-Options`, but this app's main policy is
 * report-only, and a report-only policy blocks nothing and overrides nothing.
 * So the framing rule ships as its own small enforced policy, and the
 * `X-Frame-Options` header is gone: a `SAMEORIGIN` there would block the frame
 * on its own, which is exactly what was happening.
 *
 * The handshake exists because an embedding page cannot tell a blocked frame
 * from a loaded cross-origin one. Both fire `load`, and the rest of the frame
 * is opaque to the parent by design. The embedding page shows a still by
 * default and reveals the frame only when this message arrives, which a blocked
 * frame can never send because its scripts never run.
 */

/** Origins allowed to frame this app, beyond itself. */
export const EMBED_PARENTS = [
  "https://johnjayasankar.com",
  "https://labs.johnjayasankar.com",
] as const;

/**
 * In development the loopback origins join the list, so the embed can be driven
 * against a portfolio running on this machine. Without it the browser refuses
 * the frame and there is no way to see the thing working before it ships.
 * `process.env.NODE_ENV` is "production" in every deployed build.
 */
const DEV_PARENTS =
  process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:*", "http://127.0.0.1:*"];

/** The `frame-ancestors` value, and the whole of the enforced policy. */
export const FRAME_ANCESTORS = ["'self'", ...EMBED_PARENTS, ...DEV_PARENTS].join(" ");
export const FRAMING_CSP = `frame-ancestors ${FRAME_ANCESTORS}`;

/** What the embedding page listens for. Kept the same across the products. */
export const EMBED_READY = "embed:ready";

/** A loopback parent, so the embed can be driven locally while it is built. */
function isLoopback(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

/**
 * Tell a parent that framed us that we rendered. Does nothing outside a frame,
 * and posts only to a referrer on the allowlist, so nothing reaches an unknown
 * origin.
 */
export function announceEmbed(win: Window = window): void {
  if (win.parent === win) return;
  let parentOrigin = "";
  try {
    parentOrigin = new URL(win.document.referrer).origin;
  } catch {
    return;
  }
  if (!(EMBED_PARENTS as readonly string[]).includes(parentOrigin) && !isLoopback(parentOrigin))
    return;
  win.parent.postMessage({ type: EMBED_READY, from: win.location.origin }, parentOrigin);
}
