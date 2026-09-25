'use client';

/**
 * The bar above the results: how fresh, how to refresh, how to share.
 *
 * Everything here is an explicit rider action. Nothing polls, copies or shares
 * on its own.
 */
import { useCallback, useState } from 'react';
import { formatAge } from '@/domain/freshness';
import type { LiveRefreshState } from './useLiveRefresh';

interface Props {
  busy: boolean;
  lastUpdatedAt: number | null;
  now: number;
  onRefresh: () => void;
  live: LiveRefreshState;
  onToggleLive: () => void;
  onShare: () => void;
  /** Plain-text comparison, built on demand so it is never stale. */
  onCopySummary: () => string;
  sharing: boolean;
  shareUrl: string | null;
  shareError: string | null;
  stuck: boolean;
  /**
   * The departure these prices are for, already formatted, or null for now.
   *
   * When it is set the toolbar leads with it rather than with how long ago the
   * numbers were computed: what a planner needs to see first is *which* trip
   * they are looking at.
   */
  scheduledLabel: string | null;
}

export function SessionToolbar({
  busy,
  lastUpdatedAt,
  now,
  onRefresh,
  live,
  onToggleLive,
  onShare,
  onCopySummary,
  sharing,
  shareUrl,
  shareError,
  stuck,
  scheduledLabel,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);

  const copySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(onCopySummary());
      setSummaryCopied(true);
      setTimeout(() => setSummaryCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context, permissions). Nothing is lost —
      // the same numbers are on screen.
    }
  }, [onCopySummary]);

  const copyShare = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context, permissions). The link is on
      // screen and selectable, so this is not a dead end.
    }
  }, [shareUrl]);

  return (
    <div className="rl-sticky-bar" data-stuck={stuck} style={{ paddingBottom: 'var(--sp-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          paddingTop: 'var(--sp-2)',
        }}
      >
        <p
          className="tnum"
          data-testid="updated-label"
          aria-live="polite"
          style={{
            margin: 0,
            fontSize: 'var(--t-sm)',
            color: 'var(--text-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-15)',
          }}
        >
          {busy ? (
            <>
              <span
                aria-hidden
                className="spin"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid var(--border-emphasis)',
                  borderTopColor: 'var(--text-3)',
                }}
              />
              Fetching live prices…
            </>
          ) : scheduledLabel ? (
            <span data-testid="scheduled-for">
              Priced for{' '}
              <strong style={{ fontWeight: 660, color: 'var(--text)' }}>{scheduledLabel}</strong>
            </span>
          ) : lastUpdatedAt ? (
            <>Updated {formatAge(new Date(lastUpdatedAt).toISOString(), now)}</>
          ) : null}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
          <ToolbarButton
            onClick={copySummary}
            testId="copy-summary"
            title="Copy the comparison as text, ranges and all"
          >
            {summaryCopied ? 'Copied' : 'Copy'}
          </ToolbarButton>

          <ToolbarButton
            onClick={onShare}
            disabled={sharing}
            testId="share-button"
            title="Create a link that re-runs this comparison live"
          >
            {sharing ? 'Linking…' : 'Share'}
          </ToolbarButton>

          {scheduledLabel === null && (
            <ToolbarButton
              onClick={onToggleLive}
              active={live.enabled}
              testId="live-toggle"
              title={`Auto-refresh every ${45}s while this tab is visible`}
            >
              {live.enabled ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                  <span
                    aria-hidden
                    className={live.paused ? undefined : 'breathe'}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 'var(--r-full)',
                      background: live.paused ? 'var(--text-4)' : 'var(--best)',
                    }}
                  />
                  <span className="tnum">
                    {live.paused ? 'Paused' : `${live.secondsRemaining}s`}
                  </span>
                </span>
              ) : (
                'Auto-refresh'
              )}
            </ToolbarButton>
          )}

          <button
            type="button"
            data-testid="refresh-button"
            onClick={onRefresh}
            disabled={busy}
            className="rl-press"
            style={{
              minHeight: 34,
              padding: '0 14px',
              fontSize: 'var(--t-sm)',
              fontWeight: 620,
              color: 'var(--on-inverse)',
              background: 'var(--surface-inverse)',
              border: '1px solid var(--surface-inverse)',
              borderRadius: 'var(--r-full)',
              cursor: busy ? 'progress' : 'pointer',
              opacity: busy ? 0.65 : 1,
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {live.enabled && live.paused && (
        <p style={{ margin: '6px 0 0', fontSize: 'var(--t-xs)', color: 'var(--text-3)' }}>
          Auto-refresh is paused while this tab is in the background.
        </p>
      )}
      {live.exhausted && (
        <p
          role="status"
          style={{ margin: '6px 0 0', fontSize: 'var(--t-xs)', color: 'var(--warn)' }}
        >
          Auto-refresh stopped after 12 cycles so it cannot poll unattended. Turn it back on if you
          are still watching.
        </p>
      )}

      {shareUrl && (
        <div
          data-testid="share-result"
          className="enter"
          style={{
            marginTop: 'var(--sp-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            padding: '8px 8px 8px 11px',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--e-1)',
          }}
        >
          <code
            className="mono"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-2)',
            }}
          >
            {shareUrl}
          </code>
          <button
            type="button"
            onClick={() => void copyShare()}
            data-testid="copy-share"
            className="rl-press"
            style={{
              flex: '0 0 auto',
              minHeight: 30,
              padding: '0 11px',
              fontSize: 'var(--t-sm)',
              fontWeight: 600,
              color: copied ? 'var(--best)' : 'var(--text)',
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {shareError && (
        <p
          role="alert"
          style={{ margin: '6px 0 0', fontSize: 'var(--t-xs)', color: 'var(--danger)' }}
        >
          {shareError}
        </p>
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  active,
  testId,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  testId?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
      aria-pressed={active}
      className="rl-press"
      style={{
        minHeight: 34,
        padding: '0 12px',
        fontSize: 'var(--t-sm)',
        fontWeight: 570,
        color: active ? 'var(--text)' : 'var(--text-2)',
        background: active ? 'var(--surface)' : 'transparent',
        border: `1px solid ${active ? 'var(--border-emphasis)' : 'var(--border)'}`,
        borderRadius: 'var(--r-full)',
        cursor: disabled ? 'progress' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
