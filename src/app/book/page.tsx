/*
 * A server shell whose only job is to stop this page being prerendered.
 *
 * The content policy in src/proxy.ts carries a per-request nonce, and Next
 * can only stamp that onto its bootstrap scripts while rendering a real
 * request. A page prerendered at build time has no nonce to offer, so its own
 * inline scripts are refused and React never hydrates — under an enforcing
 * policy this page sat on "Preparing handoff…" forever, which is the one
 * thing a handoff page must not do.
 *
 * `export const dynamic` has no effect inside a "use client" module, so the
 * handoff itself moved to ./book-handoff and this file carries the config.
 * Nothing is lost: it reads its parameters on the client either way.
 */
import { BookHandoff } from "./book-handoff";

export const dynamic = "force-dynamic";

export default function BookPage() {
  return <BookHandoff />;
}
