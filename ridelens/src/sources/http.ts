/**
 * Outbound HTTP for every external call.
 *
 * Responsibilities: per-request timeout, bounded response size, an identifying
 * User-Agent (required by the OSM policy), and SSRF containment — we never
 * follow a redirect off the host we intended to talk to, and we never fetch a
 * URL that arrived inside a provider payload.
 */
export interface HttpOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Hostnames this call is permitted to reach. Redirects off-list are refused. */
  allowedHosts: readonly string[];
  signal?: AbortSignal;
  /** Hard cap on response bytes we will buffer. */
  maxBytes?: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly kind: 'TIMEOUT' | 'NETWORK' | 'STATUS' | 'BLOCKED' | 'TOO_LARGE' | 'PARSE',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export const USER_AGENT =
  'RideLens/1.0 (+https://github.com/ridelens; ride comparison; contact via app operator)';

function assertHostAllowed(url: string, allowed: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(`Malformed URL`, 'BLOCKED');
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpError(`Refusing non-HTTPS request to ${parsed.protocol}//`, 'BLOCKED');
  }
  const host = parsed.hostname.toLowerCase();
  const ok = allowed.some((a) => host === a || host.endsWith(`.${a}`));
  if (!ok) throw new HttpError(`Host ${host} is not on the allowlist`, 'BLOCKED');
  return parsed;
}

export async function httpJson<T = unknown>(url: string, opts: HttpOptions): Promise<T> {
  assertHostAllowed(url, opts.allowedHosts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      // We validate the final URL ourselves rather than trusting redirects.
      redirect: 'manual',
      cache: 'no-store',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new HttpError('Redirect without Location', 'STATUS', res.status);
      const next = new URL(location, url).toString();
      assertHostAllowed(next, opts.allowedHosts);
      return httpJson<T>(next, { ...opts, timeoutMs: Math.max(1000, opts.timeoutMs - 500) });
    }

    if (!res.ok) {
      throw new HttpError(`Upstream returned ${res.status}`, 'STATUS', res.status);
    }

    const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > max) throw new HttpError('Response too large', 'TOO_LARGE');

    const text = await res.text();
    if (text.length > max) throw new HttpError('Response too large', 'TOO_LARGE');

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError('Upstream returned non-JSON', 'PARSE');
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && (err.name === 'AbortError' || err.message === 'timeout')) {
      throw new HttpError(`Request exceeded ${opts.timeoutMs}ms`, 'TIMEOUT');
    }
    throw new HttpError(err instanceof Error ? err.message : 'Network failure', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}
