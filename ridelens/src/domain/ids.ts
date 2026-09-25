import { randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Stable quote identity so repeated refreshes of the same product keep the
 * same DOM node and the price-change indicator can diff correctly.
 */
export function quoteKey(parts: {
  source: string;
  provider: string;
  providerProductId: string;
}): string {
  return `${parts.source}:${parts.provider}:${parts.providerProductId}`;
}
