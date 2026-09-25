'use client';

/**
 * Booking interstitial — the last honest screen before the rider leaves.
 *
 * It restates the route so a generic handoff can be re-entered by hand, and it
 * restates the observed price with its semantics and its age, because the
 * provider app is the only place a fare becomes real. Saying that plainly here
 * is the point of the screen.
 */
import { useCallback, useState } from 'react';
import { isInfoOnly } from '@/booking/resolver';
import { providerProfile } from '@/config/providers';
import { formatAge } from '@/domain/freshness';
import type { NormalizedQuote } from '@/domain/quote';
import { tripSummary } from '@/domain/share';
import type { CanonicalLocation } from '@/location/types';
import { ProviderMark } from './ProviderMark';
import { shortAddress } from '@/location/display';
import { Sheet } from './Sheet';
import { priceDisplay } from './format';

interface Props {
  quote: NormalizedQuote;
  pickup: CanonicalLocation;
  destination: CanonicalLocation;
  now: number;
  onContinue: () => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
  shareUrl?: string | null;
}

export function HandoffDialog({
  quote,
  pickup,
  destination,
  now,
  onContinue,
  onCancel,
  pending,
  error,
  shareUrl,
}: Props) {
  const [copied, setCopied] = useState(false);
  const profile = providerProfile(quote.provider);
  const price = priceDisplay(quote);
  const handoff = quote.bookingHandoff;
  const infoOnly = handoff !== null && isInfoOnly(handoff);

  const copyDetails = useCallback(async () => {
    const text = tripSummary({
      pickup: pickup.formattedAddress || pickup.name,
      destination: destination.formattedAddress || destination.name,
      provider: profile.displayName,
      product: quote.providerProductName,
      price: price.text,
      priceQualifier: price.qualifier ?? undefined,
      observedAt: new Date(quote.receivedAt).toLocaleString(),
      shareUrl: shareUrl ?? undefined,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked; the details are on screen and selectable.
    }
  }, [pickup, destination, profile.displayName, quote, price, shareUrl]);

  return (
    <Sheet
      open
      onClose={onCancel}
      title={`${profile.displayName} ${quote.providerProductName}`}
      lead={<ProviderMark provider={quote.provider} size={30} />}
      testId="handoff-dialog"
      maxWidth={460}
      footer={
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button
            type="button"
            onClick={copyDetails}
            data-testid="copy-trip"
            className="rl-press"
            style={{
              flex: '0 0 auto',
              minHeight: 46,
              padding: '0 15px',
              fontSize: 'var(--t-base)',
              fontWeight: 570,
              color: copied ? 'var(--best)' : 'var(--text-2)',
              background: 'transparent',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
            }}
          >
            {copied ? 'Copied' : 'Copy details'}
          </button>
          <button
            type="button"
            data-testid="handoff-continue"
            onClick={onContinue}
            disabled={pending}
            className="rl-press"
            style={{
              flex: 1,
              minHeight: 46,
              fontSize: 'var(--t-md)',
              fontWeight: 650,
              color: 'var(--on-inverse)',
              background: 'var(--surface-inverse)',
              border: '1px solid var(--surface-inverse)',
              borderRadius: 'var(--r-md)',
              cursor: pending ? 'progress' : 'pointer',
            }}
          >
            {infoOnly ? 'Got it' : pending ? 'Opening…' : `Continue to ${profile.displayName}`}
          </button>
        </div>
      }
    >
      <p className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>
        You selected
      </p>

      <dl style={{ margin: 0, display: 'grid', gap: 0 }}>
        {/* The short form. A geocoder's full string runs to five wrapped lines
            in this dialog and buries the two words that name the place; the
            complete address stays on the title attribute. */}
        <Row
          label="Pickup"
          value={shortAddress(pickup)}
          title={pickup.formattedAddress || undefined}
        />
        <Row
          label="Destination"
          value={shortAddress(destination)}
          title={destination.formattedAddress || undefined}
        />
        <Row
          label="Observed"
          value={`${price.text}${price.qualifier ? ` · ${price.qualifier}` : ''}`}
          mono
        />
        <Row label="Updated" value={formatAge(quote.receivedAt, now)} mono />
      </dl>

      {handoff?.note && (
        <p
          style={{
            margin: '13px 0 0',
            padding: '9px 11px',
            fontSize: 'var(--t-sm)',
            lineHeight: 1.5,
            color: 'var(--text-2)',
            background: 'var(--surface-sunken)',
            borderRadius: 'var(--r-sm)',
          }}
        >
          {handoff.note}
        </p>
      )}

      <p
        style={{
          margin: '12px 0 0',
          fontSize: 'var(--t-xs)',
          color: 'var(--text-3)',
          lineHeight: 1.55,
        }}
      >
        {infoOnly
          ? 'RideLens has no link to send you to for this option, so nothing here books a ride. The fare shown is what you should expect to pay.'
          : `${profile.displayName} confirms the final fare in its own app. Your account there may also show promotions or credits that RideLens cannot see.`}
      </p>

      {error && (
        <p
          role="alert"
          style={{
            margin: '12px 0 0',
            padding: '9px 11px',
            fontSize: 'var(--t-sm)',
            color: 'var(--danger)',
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-line)',
            borderRadius: 'var(--r-sm)',
          }}
        >
          {error}
        </p>
      )}
    </Sheet>
  );
}

function Row({
  label,
  value,
  title,
  mono = false,
}: {
  label: string;
  value: string;
  /** The full text, when `value` is a shortened form of it. */
  title?: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        gap: 'var(--sp-3)',
        padding: '8px 0',
        alignItems: 'baseline',
        borderTop: '1px solid var(--border)',
      }}
    >
      <dt style={{ fontSize: 'var(--t-sm)', color: 'var(--text-3)' }}>{label}</dt>
      <dd
        title={title}
        className={mono ? 'tnum' : undefined}
        style={{ margin: 0, fontSize: 'var(--t-base)', fontWeight: 540, wordBreak: 'break-word' }}
      >
        {value}
      </dd>
    </div>
  );
}
