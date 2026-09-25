import type { Metadata, Viewport } from 'next';
import './globals.css';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'RideLens — Every ride. One live comparison.',
    template: '%s · RideLens',
  },
  description:
    'Compare live ride prices and pickup times across Uber, Lyft, Empower and Curb, then book with the provider you choose.',
  applicationName: 'RideLens',
  robots: { index: true, follow: true },
  appleWebApp: { capable: true, title: 'RideLens', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false, address: false, date: false },
  openGraph: {
    type: 'website',
    siteName: 'RideLens',
    title: 'RideLens — Every ride. One live comparison.',
    description:
      'Live ride prices across providers, with every number labelled for how firm it is.',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0d12' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only sr-only-focusable">
          Skip to results
        </a>
        {children}
      </body>
    </html>
  );
}
