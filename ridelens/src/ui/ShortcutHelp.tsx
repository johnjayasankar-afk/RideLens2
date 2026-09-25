'use client';

/**
 * Keyboard shortcuts.
 *
 * A comparison is something people re-run constantly, so the two actions that
 * matter — focus the search, refresh the prices — get single keys. Shortcuts
 * never fire while a field or dialog has focus.
 */
import { useEffect } from 'react';
import { Sheet } from './Sheet';

export interface ShortcutHandlers {
  focusSearch: () => void;
  refresh: () => void;
  toggleHelp: () => void;
  closeAll: () => void;
}

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target && (EDITABLE.has(target.tagName) || target.isContentEditable === true);

      // ⌘K / Ctrl-K works even from a field — it is the "get me back" key.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.focusSearch();
        return;
      }
      if (e.key === 'Escape') {
        handlers.closeAll();
        return;
      }
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        handlers.focusSearch();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handlers.refresh();
      } else if (e.key === '?') {
        e.preventDefault();
        handlers.toggleHelp();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers, enabled]);
}

const SHORTCUTS: Array<[string, string]> = [
  ['/', 'Focus the pickup field'],
  ['⌘K / Ctrl K', 'Focus the pickup field from anywhere'],
  ['R', 'Refresh prices'],
  ['?', 'Show this list'],
  ['Esc', 'Close a panel'],
  ['↑ ↓ Enter', 'Move through and pick an address suggestion'],
];

export function ShortcutHelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      testId="shortcut-help"
      maxWidth={420}
    >
      <dl style={{ display: 'grid', gap: 0 }}>
        {SHORTCUTS.map(([key, desc], i) => (
          <div
            key={key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--sp-3)',
              padding: '9px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}
          >
            <dt>
              <kbd
                className="mono"
                style={{
                  padding: '3px 7px',
                  fontSize: 'var(--t-xs)',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border-strong)',
                  borderBottomWidth: 2,
                  borderRadius: 'var(--r-xs)',
                  color: 'var(--text-2)',
                  whiteSpace: 'nowrap',
                }}
              >
                {key}
              </kbd>
            </dt>
            <dd style={{ fontSize: 'var(--t-sm)', color: 'var(--text-2)', textAlign: 'right' }}>
              {desc}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
