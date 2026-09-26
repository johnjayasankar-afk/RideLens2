import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import { appOrigin } from "@/lib/config";
import "./globals.css";
import "./labs-glass.css";
import { headers } from "next/headers";

import { LabsUI } from "@/components/labs-ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { EmbedAnnounce } from "@/components/embed-announce";

// The Labs family type, self-hosted: Inter for reading, IBM Plex Mono for keys and figures.
const sans = localFont({
  src: "./fonts/inter-var.woff2",
  variable: "--font-sans-loaded",
  weight: "100 900",
  display: "swap",
});

const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(appOrigin()),
  title: "RideLens · Every ride. One comparison.",
  description:
    "Compare Uber, Lyft, Empower, and Curb with live routing, marketplace-aware fare estimates, and pickup waits — before you book.",
  applicationName: "RideLens",
  keywords: ["rideshare comparison", "Uber vs Lyft", "Empower", "Curb", "fare estimate"],
  appleWebApp: {
    capable: true,
    title: "RideLens",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "RideLens · Every ride. One comparison.",
    description: "Live route + rate-card estimates for Uber, Lyft, Empower, and Curb.",
    type: "website",
    siteName: "RideLens",
  },
  twitter: {
    card: "summary_large_image",
    title: "RideLens · Every ride. One comparison.",
    description: "Live route + rate-card estimates for Uber, Lyft, Empower, and Curb.",
  },
};

export const viewport = {
  /*
   * One per scheme, so the browser chrome matches the page instead of
   * sitting as a bright band above a dark app.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1511" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /* Set per request by src/proxy.ts, and named in the enforcing policy. */
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    /*
     * data-labs-glass="auto" lets the glass material follow the scheme; it
     * has had a dark variant all along and nothing was switching it on.
     *
     * suppressHydrationWarning because the script below writes data-theme
     * onto this element before React sees it — which is the point.
     */
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      data-labs-glass="auto"
      suppressHydrationWarning
    >
      <head>
        {/*
          Replays the stored scheme before first paint.
          ─────────────────────────────────────────────
          Without it a reader who chose dark gets a white flash on every
          navigation, which is the one thing dark mode exists to prevent.
          It has to be inline and synchronous — anything deferred paints
          first. Carries the nonce from src/proxy.ts, so the enforcing CSP
          does not have to make an exception for it.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("ridelens.theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to comparison
        </a>
        <header className="topbar">
          <div className="shell topbar-inner">
            <Link href="/" className="brand topbar-brand">
              <span className="brand-mark" aria-hidden />
              RideLens
            </Link>
            <nav className="topnav" aria-label="Primary">
              <Link href="/#main">Compare</Link>
              <Link href="/sources">Sources</Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <EmbedAnnounce />
        <LabsUI />
        <footer className="site-footer">
          <div className="shell site-footer-inner">
            <p className="footer-brand brand">
              <span className="brand-mark" aria-hidden />
              RideLens
            </p>
            <p className="muted footer-copy">
              Live routing + published rates + a marketplace model that tracks time, zone heat, and
              weather. Final fares are confirmed in the provider app.
            </p>
            <p className="muted footer-copy">
              <Link href="/sources">Where every number comes from</Link>
            </p>
            <p className="footer-labs">
              An independent product by{" "}
              <a href="https://johnjayasankar.com" target="_top">
                John Jayasankar
              </a>
              , part of{" "}
              <a href="https://labs.johnjayasankar.com" target="_top">
                Labs
              </a>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
