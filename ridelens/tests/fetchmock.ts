/**
 * Network boundary stub.
 *
 * Adapters are exercised end to end — real URL construction, real schema
 * validation, real normalisation — with only the socket replaced. Nothing
 * inside src/ knows it is under test.
 */
export interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

export class FetchMock {
  readonly calls: RecordedCall[] = [];
  private routes: Route[] = [];
  private original: typeof fetch | undefined;

  install(): void {
    this.original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      let body: unknown = null;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      this.calls.push({ url, method: init?.method ?? 'GET', body });

      for (const route of this.routes) {
        if (route.match(url, init)) return route.respond(url, init);
      }
      throw new TypeError(`No stub for ${url}`);
    }) as typeof fetch;
  }

  restore(): void {
    if (this.original) globalThis.fetch = this.original;
    this.routes = [];
    this.calls.length = 0;
  }

  on(pattern: string | RegExp, payload: unknown, status = 200): this {
    this.routes.push({
      match: (url) => (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)),
      respond: () =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    return this;
  }

  /** Responds after `delayMs`, for exercising concurrency. */
  onDelay(pattern: string | RegExp, payload: unknown, delayMs: number): this {
    this.routes.push({
      match: (url) => (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)),
      respond: () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify(payload), {
                  headers: { 'Content-Type': 'application/json' },
                }),
              ),
            delayMs,
          ),
        ),
    });
    return this;
  }

  /** Never resolves before the caller's timeout fires. */
  onHang(pattern: string | RegExp, delayMs = 30_000): this {
    this.routes.push({
      match: (url) => (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)),
      respond: (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(new Response('{}', { status: 200 })), delayMs);
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    return this;
  }

  onError(pattern: string | RegExp, message = 'connection reset'): this {
    this.routes.push({
      match: (url) => (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)),
      respond: () => {
        throw new TypeError(message);
      },
    });
    return this;
  }

  urls(): string[] {
    return this.calls.map((c) => c.url);
  }
}
