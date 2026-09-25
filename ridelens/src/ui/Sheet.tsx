'use client';

/**
 * Accessible sheet.
 *
 * One implementation for every overlay so focus handling is correct
 * everywhere rather than re-derived per dialog: focus moves in on open,
 * is trapped while open, Escape closes, the scrim click closes, background
 * scroll is locked, and focus returns to whatever opened it.
 *
 * Presents as a bottom sheet on narrow screens and a centred panel on wide
 * ones — the same component, because the semantics are identical.
 */
import { useCallback, useEffect, useId, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Rendered beside the title, e.g. a provider mark. */
  lead?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
  maxWidth?: number;
}

export function Sheet({
  open,
  onClose,
  title,
  lead,
  children,
  footer,
  testId,
  maxWidth = 520,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const focusables = useCallback((): HTMLElement[] => {
    const node = panelRef.current;
    if (!node) return [];
    return Array.from(
      node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
      // `getClientRects()` rather than `offsetParent`: a descendant of a
      // `position: fixed` ancestor has a null offsetParent even when it is
      // plainly on screen, which would empty this list and make the trap
      // swallow every Tab.
    ).filter((el) => el.getClientRects().length > 0);
  }, []);

  /**
   * `onClose` behind a ref, so the effect below depends only on `open`.
   *
   * Callers pass an inline arrow — `onClose={() => setInspecting(null)}` — which
   * is a new function on every render of the page, and the page re-renders once
   * a second to age the freshness label. With `onClose` in the dependency list
   * the whole effect tore down and re-ran on every one of those ticks, and its
   * cleanup calls `returnFocusRef.current?.focus?.()`. So an open dialog threw
   * focus back onto the button behind it once a second. For anyone navigating
   * by keyboard or screen reader that is not a flake, it is the dialog
   * ejecting them mid-sentence.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the panel itself rather than the first control: announcing the
    // dialog title beats jumping straight onto a destructive-looking button.
    const raf = requestAnimationFrame(() => panelRef.current?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      /*
       * Position by index, not by identity.
       *
       * This used to compare `active === last`, and the list is recomputed on
       * every Tab — the sheet's contents mount as data arrives, so the element
       * that was last a moment ago may not be any more. When that comparison
       * missed, Tab walked straight out of the dialog and onto the page behind
       * it. Intermittently, which is the worst way for a focus trap to fail.
       *
       * Anything not in the list at all has already drifted out (its element
       * was removed under it), so it comes back to the first item.
       */
      const index = active ? items.indexOf(active) : -1;
      if (index === -1) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && index === 0) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && index === items.length - 1) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open, focusables]);

  if (!open) return null;

  return (
    <div
      className="scrim-in"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgb(6 9 13 / 0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 'max(12px, env(safe-area-inset-left)) 12px 0',
      }}
    >
      <style>{`
        @media (min-width: 640px) {
          .rl-sheet-wrap { align-items: center !important; padding-bottom: 24px !important; }
          .rl-sheet { border-radius: var(--r-xl) !important; max-height: 86dvh !important; }
        }
      `}</style>
      <div
        className="rl-sheet-wrap"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: '12px',
          pointerEvents: 'none',
        }}
      >
        <div
          ref={panelRef}
          className="rl-sheet sheet-in thin-scroll"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid={testId}
          tabIndex={-1}
          style={{
            pointerEvents: 'auto',
            width: '100%',
            maxWidth,
            maxHeight: '90dvh',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl) var(--r-xl) var(--r-lg) var(--r-lg)',
            boxShadow: 'var(--e-4)',
            marginBottom: 'env(safe-area-inset-bottom, 0)',
            outline: 'none',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-3)',
              padding: '15px 16px 12px',
              borderBottom: '1px solid var(--border)',
              flex: '0 0 auto',
            }}
          >
            {lead}
            <h2
              id={titleId}
              className="display"
              style={{ flex: 1, minWidth: 0, fontSize: 'var(--t-lg)', fontWeight: 640 }}
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-testid="sheet-close"
              className="rl-press"
              style={{
                flex: '0 0 auto',
                width: 32,
                height: 32,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-full)',
                color: 'var(--text-2)',
                cursor: 'pointer',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M1.5 1.5l11 11M12.5 1.5l-11 11"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>

          <div
            className="thin-scroll"
            style={{ flex: '1 1 auto', overflowY: 'auto', padding: '14px 16px 16px' }}
          >
            {children}
          </div>

          {footer && (
            <footer
              style={{
                flex: '0 0 auto',
                padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
                borderTop: '1px solid var(--border)',
                background: 'var(--surface-2)',
                borderRadius: '0 0 var(--r-lg) var(--r-lg)',
              }}
            >
              {footer}
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}
