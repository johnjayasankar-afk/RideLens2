/**
 * Process-wide singletons.
 *
 * Next evaluates a module more than once in the same process — route handlers,
 * server components and different route groups can each get their own instance
 * of the module graph. Anything held in a plain module-level variable is
 * therefore per-instance, not per-process.
 *
 * For counters that is merely inaccurate. For the in-memory share store it is a
 * correctness bug: a link minted by `POST /api/share` would 404 in the page
 * that renders `/s/<id>`, because the two hold different Maps.
 *
 * Pinning to `globalThis` makes "in-memory" mean what a reader assumes it
 * means. Production still prefers the durable backends; this only fixes the
 * fallbacks.
 */
const REGISTRY = Symbol.for('ridelens.singletons');

type Registry = Map<string, unknown>;

function registry(): Registry {
  const g = globalThis as typeof globalThis & { [REGISTRY]?: Registry };
  if (!g[REGISTRY]) g[REGISTRY] = new Map<string, unknown>();
  return g[REGISTRY];
}

export function singleton<T>(key: string, create: () => T): T {
  const reg = registry();
  const existing = reg.get(key);
  if (existing !== undefined) return existing as T;
  const value = create();
  reg.set(key, value);
  return value;
}

/** Test seam: drop one singleton so the next access rebuilds it. */
export function clearSingleton(key: string): void {
  registry().delete(key);
}

export function clearAllSingletons(): void {
  registry().clear();
}
