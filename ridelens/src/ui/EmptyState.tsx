'use client';

/**
 * First-run state.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SHOW, THEN COVER, THEN EXPLAIN                                           │
 * │                                                                          │
 * │ This screen used to lead with three numbered points about methodology —  │
 * │ an answer to "why should I trust this?" delivered before anybody had      │
 * │ asked, and before a single number had been shown. Everything the product │
 * │ is persuasive about was one form submission away, and the form was       │
 * │ empty.                                                                   │
 * │                                                                          │
 * │ So the order is inverted. A real trip first, one tap away and priced by  │
 * │ the ordinary path. Then what is covered, because "will this work where   │
 * │ I am?" is the next question. The methodology last, where it belongs —    │
 * │ it is the answer to a question the fare itself provokes.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { SCHEDULE_HORIZON_DAYS } from '@/app/api/_lib/schemas';
import { EXAMPLE_TRIPS, type ExampleTrip } from '@/domain/examples';
import { LogoMark } from './Brand';

interface Props {
  liveDataAvailable: boolean;
  coveredMarkets: string[];
  bikeSystems: string[];
  railSystems: string[];
  onShowShortcuts: () => void;
  /** Runs one of the example trips through the ordinary comparison path. */
  onPickExample: (trip: ExampleTrip) => void;
}

const POINTS: Array<[string, string]> = [
  [
    'One route, every provider',
    'The exact same two points go to each connected provider, so the fares are genuinely comparable.',
  ],
  [
    'Labelled, not rounded',
    'A $27–34 range stays a range. An estimate is never dressed up as an upfront fare.',
  ],
  [
    'Silence over guesswork',
    'If a provider cannot be reached, RideLens says so rather than filling the gap with a number.',
  ],
];

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 'var(--sp-5)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--e-1)',
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 'var(--t-2xs)',
        fontWeight: 660,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-4)',
      }}
    >
      {children}
    </p>
  );
}

/** One coverage column. Three of these; the markup was identical in each. */
function Coverage({
  title,
  blurb,
  items,
}: {
  title: string;
  blurb: React.ReactNode;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 style={{ margin: 0, fontSize: 'var(--t-base)', fontWeight: 640 }}>{title}</h3>
      <p
        style={{
          margin: '3px 0 var(--sp-3)',
          fontSize: 'var(--t-sm)',
          color: 'var(--text-2)',
          lineHeight: 1.5,
        }}
      >
        {blurb}
      </p>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
        }}
      >
        {items.map((item) => (
          <li key={item}>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 9px',
                fontSize: 'var(--t-xs)',
                fontWeight: 560,
                color: 'var(--text-2)',
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-full)',
                whiteSpace: 'nowrap',
              }}
            >
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EmptyState({
  liveDataAvailable,
  coveredMarkets,
  bikeSystems,
  railSystems,
  onShowShortcuts,
  onPickExample,
}: Props) {
  return (
    <div
      data-testid="empty-state"
      className="enter"
      style={{ display: 'grid', gap: 'var(--sp-4)' }}
    >
      <Panel>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
          <LogoMark size={40} />
          <div style={{ minWidth: 0 }}>
            <h2
              className="display"
              style={{
                margin: 0,
                fontSize: 'var(--t-xl)',
                fontWeight: 680,
                letterSpacing: '-0.025em',
                lineHeight: 1.2,
              }}
            >
              Where are you going?
            </h2>
            <p
              style={{
                margin: 'var(--sp-2) 0 0',
                fontSize: 'var(--t-base)',
                lineHeight: 1.55,
                color: 'var(--text-2)',
                maxWidth: '52ch',
              }}
            >
              Enter a pickup and a destination and RideLens fetches what each provider is charging
              right now, with the certainty of every number spelled out. Or start with one of these:
            </p>
          </div>
        </div>

        <ul
          data-testid="example-trips"
          style={{
            margin: 'var(--sp-5) 0 0',
            padding: 0,
            listStyle: 'none',
            display: 'grid',
            /* `minmax(0, 1fr)`, not the implicit `auto`: a grid track sized to
               its content lets a long route name push the whole row wider than
               the phone, and the ellipsis that was supposed to prevent it never
               engages because nothing ever constrained the width. */
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: 'var(--sp-2)',
          }}
        >
          {EXAMPLE_TRIPS.map((trip) => (
            <li key={trip.id} style={{ minWidth: 0 }}>
              <button
                type="button"
                data-testid={`example-${trip.id}`}
                onClick={() => onPickExample(trip)}
                /* Spelled out, because the arrow between the two places is a
                   glyph a screen reader reads as "right arrow" or not at all. */
                aria-label={`Price ${trip.fromLabel} to ${trip.toLabel} — ${trip.shows}`}
                className="rl-press rl-example"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-3)',
                  width: '100%',
                  minHeight: 56,
                  padding: 'var(--sp-2) var(--sp-3)',
                  textAlign: 'left',
                  fontFamily: 'var(--font-sans)',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--t-base)',
                      fontWeight: 620,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {trip.fromShort}{' '}
                    <span aria-hidden style={{ color: 'var(--text-4)' }}>
                      →
                    </span>{' '}
                    {trip.toShort}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 'var(--sp-05)',
                      fontSize: 'var(--t-xs)',
                      color: 'var(--text-3)',
                      lineHeight: 1.45,
                    }}
                  >
                    {trip.market} · {trip.shows}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="rl-example-arrow"
                  style={{
                    flex: '0 0 auto',
                    fontSize: 'var(--t-base)',
                    color: 'var(--text-4)',
                  }}
                >
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p
          style={{
            margin: 'var(--sp-3) 0 0',
            fontSize: 'var(--t-xs)',
            color: 'var(--text-4)',
            lineHeight: 1.5,
          }}
        >
          Real trips, priced the ordinary way — the live geocoder, live routing and the city&rsquo;s
          own tariff. Nothing here is a stored example fare.
        </p>
      </Panel>

      {liveDataAvailable && coveredMarkets.length > 0 && (
        <Panel>
          <Eyebrow>Live right now, with no setup</Eyebrow>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))',
              gap: 'var(--sp-5)',
              marginTop: 'var(--sp-3)',
            }}
          >
            <Coverage
              title="Regulated taxi fares"
              blurb={
                <>
                  Computed from the city&rsquo;s own published rate card. Airport flat fares are
                  exact.
                </>
              }
              items={coveredMarkets}
            />
            <Coverage
              title="Commuter rail"
              blurb={
                <>
                  The operator&rsquo;s published zone fare &mdash; the priced option for the
                  suburb-to-city trips no city meter covers.
                </>
              }
              items={railSystems}
            />
            <Coverage
              title="Shared bikes"
              blurb={
                <>
                  Live station counts from the operator&rsquo;s open feed, refreshed every minute.
                </>
              }
              items={bikeSystems}
            />
          </div>

          {/* A capability nobody would guess at from a search box. These fares
              are published rules, so the same tariffs price a departure days
              out — which is exactly the trip people plan rather than take. */}
          <p
            data-testid="schedule-hint"
            style={{
              margin: 'var(--sp-4) 0 0',
              paddingTop: 'var(--sp-3)',
              borderTop: '1px solid var(--border)',
              fontSize: 'var(--t-sm)',
              color: 'var(--text-2)',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ fontWeight: 620, color: 'var(--text)' }}>Flying on Tuesday?</strong>{' '}
            Set a departure and the same published tariffs price that moment — the 4pm surcharge,
            the off-peak train — up to {SCHEDULE_HORIZON_DAYS} days ahead. Nothing is forecast; the
            rule already says what it will cost.
          </p>

          <p
            style={{
              margin: 'var(--sp-4) 0 0',
              paddingTop: 'var(--sp-3)',
              borderTop: '1px solid var(--border)',
              fontSize: 'var(--t-xs)',
              color: 'var(--text-3)',
              lineHeight: 1.5,
            }}
          >
            Uber, Lyft and Empower need an authorized data agreement, which this deployment does not
            have. They are shown as unavailable with the reason, never filled in with an estimate.
          </p>
        </Panel>
      )}

      {!liveDataAvailable && (
        <Panel>
          <Eyebrow>No live source</Eyebrow>
          <p
            style={{
              margin: 'var(--sp-2) 0 0',
              fontSize: 'var(--t-sm)',
              color: 'var(--text-2)',
              lineHeight: 1.5,
            }}
          >
            No live source is connected in this deployment, so a comparison will report every
            provider as unavailable rather than show a price.
          </p>
        </Panel>
      )}

      <Panel>
        <Eyebrow>How a number gets on this screen</Eyebrow>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))',
            gap: 'var(--sp-4)',
            marginTop: 'var(--sp-3)',
          }}
        >
          {POINTS.map(([title, body]) => (
            <div key={title}>
              <h3 style={{ margin: 0, fontSize: 'var(--t-sm)', fontWeight: 640 }}>{title}</h3>
              <p
                style={{
                  margin: '3px 0 0',
                  fontSize: 'var(--t-sm)',
                  color: 'var(--text-2)',
                  lineHeight: 1.5,
                }}
              >
                {body}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <button
        type="button"
        onClick={onShowShortcuts}
        className="rl-tap"
        style={{
          justifySelf: 'start',
          padding: 0,
          background: 'none',
          border: 'none',
          fontSize: 'var(--t-xs)',
          color: 'var(--text-4)',
          cursor: 'pointer',
        }}
      >
        Press <kbd className="mono">?</kbd> for keyboard shortcuts
      </button>
    </div>
  );
}
