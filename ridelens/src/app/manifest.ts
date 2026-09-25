import type { MetadataRoute } from 'next';

/**
 * Installable web app. A price comparison is something people reach for on a
 * pavement in the rain, so a home-screen icon and a standalone window are
 * genuine utility rather than checkbox PWA-ness.
 *
 * No service worker is registered: caching a fare offline would be the exact
 * opposite of this product's promise.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RideLens — Every ride. One live comparison.',
    short_name: 'RideLens',
    description:
      'Compare live ride prices and pickup times across Uber, Lyft, Empower and Curb, then book with the provider you choose.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0e13',
    theme_color: '#0b0e13',
    categories: ['travel', 'navigation', 'utilities'],
    icons: [
      { src: '/icon', sizes: '64x64', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
