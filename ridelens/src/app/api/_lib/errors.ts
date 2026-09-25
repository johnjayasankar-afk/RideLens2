/**
 * One error shape for every API route.
 *
 * A client should never have to guess whether a failure is retryable, nor
 * receive an internal stack trace. Every route returns
 * `{ error, message, retryable }` and nothing else.
 */
import { NextResponse } from 'next/server';
import { logger } from '@/observability/logger';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'NO_SOURCE_CONFIGURED'
  | 'GEOCODER_UNAVAILABLE'
  | 'DESTINATION_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'UPSTREAM_FAILED'
  | 'INTERNAL'
  | 'PICKUP_UNRESOLVED'
  | 'DESTINATION_UNRESOLVED'
  | 'SAME_POINT'
  | 'TOO_FAR'
  | 'CROSS_COUNTRY';

const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set([
  'RATE_LIMITED',
  'GEOCODER_UNAVAILABLE',
  'UPSTREAM_FAILED',
  'INTERNAL',
]);

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  retryable: boolean;
}

export function apiError(
  status: number,
  error: ApiErrorCode,
  message: string,
  headers?: Record<string, string>,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error, message, retryable: RETRYABLE.has(error) },
    { status, headers },
  );
}

/**
 * Wraps a route handler so an unexpected throw becomes a clean 500 with a
 * correlation id, and the detail goes to the log rather than to the client.
 */
export function withErrorEnvelope(
  route: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (err) {
      const ref = Math.random().toString(36).slice(2, 10);
      logger.error('route.unhandled', {
        route,
        ref,
        message: err instanceof Error ? err.message : 'unknown',
      });
      return apiError(500, 'INTERNAL', `Something went wrong on our side. Reference ${ref}.`);
    }
  };
}
