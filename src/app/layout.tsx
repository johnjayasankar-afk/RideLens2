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
   * No `themeColor` here, and that is the fix rather than an omission.
   *
   * A media-keyed pair answers the OS and cannot answer the reader: someone
   * on a dark machine who chooses Light got a porcelain page under a
   * #0d1511 chrome band, and with `appleWebApp.capable` that band is the iOS
   * standalone status bar on every screen. Two of the six OS x choice
   * combinations were wrong.
   *
   * It also cannot simply be corrected from script, because these tags are
   * React-managed metadata: the inline script below removed them and React
   * put one back during hydration, leaving two. So the tag belongs to one
   * owner. The script in <head> writes it synchronously before first paint
   * and theme-toggle.tsx keeps it true afterwards.
   */
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
          The basemap is the only third-party origin the browser talks to
          directly — routing, geocoding and weather all go through our own
          API. Measured cold, the TLS handshake to it cost 83ms, paid at the
          moment the map is trying to appear. `preconnect` moves that cost
          into the idle time while the page is still parsing.

          The tile subdomains are only dns-prefetch: four preconnects would
          open four sockets the page may never use, and a DNS lookup is the
          part worth having early.
        */}
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://tiles.basemaps.cartocdn.com" />
        {/*
          Replays the stored scheme before first paint.
          ─────────────────────────────────────────────
          Without it a reader who chose dark gets a white flash on every
          navigation, which is the one thing dark mode exists to prevent.
          It has to be inline and synchronous — anything deferred paints
          first. Carries the nonce from src/proxy.ts, so the enforcing CSP
          does not have to make an exception for it.

          It also fixes the browser chrome, for the same reason and in the
          same frame. `viewport.themeColor` above is keyed on
          prefers-color-scheme alone, so a reader on a dark machine who chose
          Light got a porcelain page under a #0d1511 chrome band — and with
          appleWebApp.capable that band is the iOS standalone status bar, on
          every screen. A media-keyed meta that matches still wins over one
          without, so the pair is replaced rather than added to.

          The colours are the two --ground values, written here as literals
          because this runs before the stylesheet has applied and there is
          nothing yet to read them from. tests/e2e/compare.spec.ts checks all
          six combinations against the --ground the page actually computes,
          so a literal that drifts fails rather than lingers.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("ridelens.theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].remove();var e=document.createElement("meta");e.name="theme-color";e.content=d?"#0d1511":"#f8f6f1";document.head.appendChild(e)}catch(e){}`,
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
              {/* Wrapped so the narrowest screens can drop the wordmark and
                  keep the nav on one line. It is clipped rather than
                  removed — the mark is aria-hidden, so this text is the
                  link's only accessible name. */}
              <span className="brand-word">RideLens</span>
            </Link>
            <nav className="topnav" aria-label="Primary">
              <Link href="/#main">Compare</Link>
              <Link href="/trips">Trips</Link>
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
