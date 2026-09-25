/**
 * In-flight request coalescing.
 *
 * Two riders searching the same route at the same second should cost one
 * upstream call, not two. The cache only helps once a response has landed;
 * this closes the window while one is still in flight.
 *
 * Keyed by the same cache key, so the account-scope isolation that keeps one
 * rider's linked-account price away from another applies here unchanged.
 */
export class InFlightRegistry<T> {
  private pending = new Map<string, Promise<T>>();

  /**
   * Runs `fn` unless an identical call is already running, in which case the
   * caller joins the existing one. A rejection is shared too — both callers
   * see the same failure, which is correct: it is the same upstream call.
   */
  async run(key: string, fn: () => Promise<T>): Promise<{ value: T; joined: boolean }> {
    const existing = this.pending.get(key);
    if (existing) return { value: await existing, joined: true };

    const promise = fn();
    this.pending.set(key, promise);
    try {
      return { value: await promise, joined: false };
    } finally {
      // Only clear if we are still the owner; a later call may have replaced it.
      if (this.pending.get(key) === promise) this.pending.delete(key);
    }
  }

  size(): number {
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
  }
}
