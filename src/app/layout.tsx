import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display-loaded",
  display: "swap",
});

const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body-loaded",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000",
  ),
  title: "RideLens — Every ride. One comparison.",
  description:
    "Compare Uber, Lyft, Empower, and Curb with live routing, tight fare estimates, and pickup waits — before you book.",
  applicationName: "RideLens",
  keywords: [
    "rideshare comparison",
    "Uber vs Lyft",
    "Empower",
    "Curb",
    "fare estimate",
  ],
  appleWebApp: {
    capable: true,
    title: "RideLens",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "RideLens — Every ride. One comparison.",
    description:
      "Live route + rate-card estimates for Uber, Lyft, Empower, and Curb.",
    type: "website",
    siteName: "RideLens",
  },
  twitter: {
    card: "summary_large_image",
    title: "RideLens — Every ride. One comparison.",
    description:
      "Live route + rate-card estimates for Uber, Lyft, Empower, and Curb.",
  },
};

export const viewport = {
  themeColor: "#070a0e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to comparison
        </a>
        <header className="topbar">
          <div className="shell topbar-inner">
            <Link href="/" className="brand topbar-brand">
              RideLens
            </Link>
            <nav className="topnav" aria-label="Primary">
              <a href="#main">Compare</a>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer">
          <div className="shell site-footer-inner">
            <p className="footer-brand brand">RideLens</p>
            <p className="muted footer-copy">
              Estimates from live routes and published rate cards. Final fares
              are confirmed in the provider app.
            </p>
            <p className="footer-links muted">
              <Link href="/admin">Source status</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
