'use client';

/**
 * Provider mark.
 *
 * A letterform tile in the provider's accent, not their logo. Reproducing a
 * ride company's trademark in a comparison product is a legal question we have
 * no answer to, so RideLens uses a consistent typographic mark instead — which
 * also keeps the row rhythm perfectly even, something mixed-aspect logos never
 * manage.
 */
import { providerProfile } from '@/config/providers';
import type { ProviderId } from '@/domain/quote';

interface Props {
  provider: ProviderId;
  size?: number;
  dimmed?: boolean;
}

export function ProviderMark({ provider, size = 26, dimmed = false }: Props) {
  const profile = providerProfile(provider);
  return (
    <span
      aria-hidden
      data-provider-mark={provider}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: `0 0 ${size}px`,
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: dimmed ? 'var(--surface-sunken)' : profile.accent,
        color: dimmed ? 'var(--text-4)' : profile.onAccent,
        fontFamily: 'var(--font-display)',
        fontSize: Math.round(size * 0.46),
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        userSelect: 'none',
        boxShadow: dimmed ? 'none' : 'inset 0 0 0 1px rgb(255 255 255 / 0.08)',
      }}
    >
      {profile.initials}
    </span>
  );
}
