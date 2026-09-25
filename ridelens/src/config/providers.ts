/**
 * Provider-level facts, declared once.
 *
 * The UI reads capabilities from here rather than hard-coding assumptions like
 * "Empower has no upfront price" in a component. When a provider's semantics
 * change, this file changes and every surface follows.
 */
import type { ProviderId } from '@/domain/quote';

export interface ProviderProfile {
  id: ProviderId;
  displayName: string;
  /** Short brand mark used in the card avatar. */
  initials: string;
  /** Brand accent, used sparingly — a hairline rail and the provider mark. */
  accent: string;
  /** Foreground that meets contrast on `accent`. Declared, never derived. */
  onAccent: string;
  /**
   * What kind of number this provider's rider-facing flow commits to, absent
   * source-specific evidence. Used only for copy; the actual PriceType always
   * comes from the source payload.
   */
  typicalPriceSemantics: string;
  /** Booking domains permitted for this provider. Enforced in booking/allowlist. */
  bookingHosts: string[];
  supportsAccountLink: boolean;
  accountLinkNote: string | null;
}

export const PROVIDER_PROFILES: Readonly<Record<ProviderId, ProviderProfile>> = {
  uber: {
    id: 'uber',
    displayName: 'Uber',
    initials: 'U',
    accent: '#0f0f0f',
    onAccent: '#ffffff',
    typicalPriceSemantics:
      'Uber shows an upfront fare in its own app; API price data is an estimate or range.',
    bookingHosts: ['m.uber.com', 'uber.com', 'www.uber.com', 'ride.uber.com'],
    supportsAccountLink: true,
    accountLinkNote:
      'Uber supports OAuth. Account-linked quoting additionally requires quote scopes granted under a commercial agreement.',
  },
  lyft: {
    id: 'lyft',
    displayName: 'Lyft',
    initials: 'L',
    accent: '#ea0b8c',
    onAccent: '#ffffff',
    typicalPriceSemantics: 'Lyft shows an upfront fare in its own app; API cost data is a range.',
    bookingHosts: ['lyft.com', 'www.lyft.com', 'ride.lyft.com'],
    supportsAccountLink: false,
    accountLinkNote:
      'Lyft closed its public developer programme; no OAuth application can currently be created.',
  },
  empower: {
    id: 'empower',
    displayName: 'Empower',
    initials: 'E',
    accent: '#00b464',
    onAccent: '#04240f',
    typicalPriceSemantics:
      'Empower is driver-priced. The rider-facing number before a driver accepts is an estimate, not a locked fare.',
    bookingHosts: ['empower.app', 'www.empower.app', 'rideempower.com', 'www.rideempower.com'],
    supportsAccountLink: false,
    accountLinkNote: 'No published OAuth or partner authentication flow.',
  },
  curb: {
    id: 'curb',
    displayName: 'Curb',
    initials: 'C',
    accent: '#f5a623',
    onAccent: '#2a1c00',
    typicalPriceSemantics:
      'Curb dispatches licensed taxis. Depending on market it offers an upfront fare or a metered estimate.',
    bookingHosts: ['gocurb.com', 'www.gocurb.com', 'curbmobility.com', 'www.curbmobility.com'],
    supportsAccountLink: false,
    accountLinkNote: 'Account linking would be defined by a Curb Flow partner agreement.',
  },
  taxi: {
    id: 'taxi',
    displayName: 'Licensed taxi',
    initials: 'T',
    accent: '#e8b005',
    onAccent: '#241900',
    typicalPriceSemantics:
      'A regulated fare set by the local authority. Airport flat fares are exact; metered fares vary with traffic. It never surges.',
    bookingHosts: [],
    supportsAccountLink: false,
    accountLinkNote: null,
  },
  bikeshare: {
    id: 'bikeshare',
    displayName: 'Shared bike',
    initials: 'B',
    accent: '#0b7fd4',
    onAccent: '#ffffff',
    typicalPriceSemantics:
      'An unlock fee plus a published per-minute rate. The total depends on how long the ride takes, and station availability is live.',
    bookingHosts: [],
    supportsAccountLink: false,
    accountLinkNote: null,
  },
  transit: {
    id: 'transit',
    displayName: 'Regional rail',
    initials: 'R',
    accent: '#0057a8',
    onAccent: '#ffffff',
    typicalPriceSemantics:
      'A published fare set by the transit authority, fixed by zone rather than by distance. Peak and off-peak are the only thing that moves it, and it never surges.',
    bookingHosts: [],
    supportsAccountLink: false,
    accountLinkNote: null,
  },
  waymo: {
    id: 'waymo',
    displayName: 'Waymo',
    initials: 'W',
    accent: '#4285f4',
    onAccent: '#ffffff',
    typicalPriceSemantics: 'Waymo quotes an upfront fare for a fully autonomous ride.',
    bookingHosts: ['waymo.com', 'www.waymo.com'],
    supportsAccountLink: false,
    accountLinkNote: null,
  },
  other: {
    id: 'other',
    displayName: 'Other',
    initials: '·',
    accent: '#6b7280',
    onAccent: '#ffffff',
    typicalPriceSemantics: 'Semantics unknown until verified against the source contract.',
    bookingHosts: [],
    supportsAccountLink: false,
    accountLinkNote: null,
  },
};

export function providerProfile(id: ProviderId): ProviderProfile {
  return PROVIDER_PROFILES[id] ?? PROVIDER_PROFILES.other;
}
