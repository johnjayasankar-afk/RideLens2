/**
 * Structured logging with mandatory redaction.
 *
 * Two categories never reach a log line:
 *  - credentials (any *_KEY, token, secret, authorization header)
 *  - precise coordinates and full street addresses
 *
 * Coordinates are coarsened to ~1 km before they are permitted anywhere near
 * a log or a metric. See docs/SECURITY.md §Location privacy.
 */
import { coarsen } from '@/location/types';

type Level = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEY_PATTERN = /(key|token|secret|password|authorization|credential|bearer|apikey)/i;

/** Anything that looks like a full decimal coordinate pair. */
const COORD_PATTERN = /-?\d{1,3}\.\d{4,}/g;

export type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogValue[]
  | { [k: string]: LogValue };

export function redact(input: LogValue): LogValue {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return input.replace(COORD_PATTERN, '[coord]');
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map(redact);

  const out: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (k === 'lat' || k === 'lng' || k === 'latitude' || k === 'longitude') {
      out[k] = '[coord]';
      continue;
    }
    if (k === 'formattedAddress' || k === 'address') {
      out[k] = '[address]';
      continue;
    }
    out[k] = redact(v);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, LogValue>): void;
  info(msg: string, fields?: Record<string, LogValue>): void;
  warn(msg: string, fields?: Record<string, LogValue>): void;
  error(msg: string, fields?: Record<string, LogValue>): void;
}

function emit(level: Level, msg: string, fields?: Record<string, LogValue>): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (redact(fields) as Record<string, LogValue>) : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger: Logger = {
  debug: (m, f) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', m, f);
  },
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
};

/** The only coordinate form permitted in analytics. ~1 km resolution. */
export function analyticsGeo(lat: number, lng: number): { lat: number; lng: number } {
  return coarsen(lat, lng);
}
