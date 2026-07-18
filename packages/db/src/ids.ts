import { randomUUID } from 'node:crypto';

/**
 * Human-readable prefixed ID. A truncated UUID provides enough entropy for the
 * primary key while avoiding wall-clock timestamps in domain identifiers.
 */
export function uid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
