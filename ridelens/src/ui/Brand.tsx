/**
 * The RideLens mark.
 *
 * The idea is literal, which is why it works at 20px: a lens over a route. The
 * ring is the lens, the line through it is the trip from A to B, and the two
 * nodes are the endpoints the whole product is built around. It is the same
 * figure as the favicon and the OG image, so the tab, the share card and the
 * header are recognisably one thing.
 *
 * Drawn rather than imported: an SVG in the bundle needs no network round trip,
 * scales without a second asset, inherits `currentColor` so it is correct in
 * both themes, and can be read in a diff.
 */

interface MarkProps {
  /** Rendered size in px. The geometry is defined on a 32-unit grid. */
  size?: number;
  /** Decorative next to the wordmark; labelled when it stands alone. */
  title?: string;
}

export function LogoMark({ size = 30, title }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <rect width="32" height="32" rx="9" fill="var(--brand-plate)" />
      {/* The lens. */}
      <circle cx="16" cy="16" r="9.1" stroke="var(--brand-ring)" strokeWidth="2.1" />
      {/* The trip through it, drawn over the ring so the path reads as one line. */}
      <path
        d="M7.4 22.6 L24.6 9.4"
        stroke="var(--brand-route)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="7.4" cy="22.6" r="2.5" fill="var(--brand-route)" />
      <circle cx="24.6" cy="9.4" r="2.5" fill="var(--brand-route)" />
      {/* The aperture, which also hides the crossing behind a clean centre. */}
      <circle cx="16" cy="16" r="3.5" fill="var(--brand-plate)" />
      <circle cx="16" cy="16" r="2.1" fill="var(--brand-ring)" />
    </svg>
  );
}

interface LockupProps {
  /** Mark size; the wordmark scales with it. */
  size?: number;
  /** Shown under the wordmark. Omitted in tight spaces. */
  tagline?: string;
  /** Renders as an h1. Off for chrome that is not the page heading. */
  heading?: boolean;
}

/**
 * Mark plus wordmark, locked together.
 *
 * The two are aligned on the mark's optical centre rather than on a text
 * baseline: a baseline puts a square mark visibly low next to a cap-height
 * word, which is the sort of half-pixel wrongness you feel before you see.
 */
export function BrandLockup({ size = 30, tagline, heading = false }: LockupProps) {
  const Name = heading ? 'h1' : 'span';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0 }}>
      <LogoMark size={size} title="RideLens" />
      <div style={{ display: 'grid', gap: 0, minWidth: 0 }}>
        <Name
          className="display"
          style={{
            margin: 0,
            fontSize: Math.round(size * 0.62),
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: '-0.032em',
            color: 'var(--text)',
            whiteSpace: 'nowrap',
          }}
        >
          RideLens
        </Name>
        {tagline && (
          <span
            style={{
              fontSize: 'var(--t-xs)',
              lineHeight: 1.25,
              color: 'var(--text-3)',
              letterSpacing: '-0.005em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tagline}
          </span>
        )}
      </div>
    </div>
  );
}
