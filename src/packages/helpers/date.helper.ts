/**
 * RPC payloads are JSON, so a `Date` sent from gateway arrives as an ISO string. Drizzle's
 * timestamp columns call `toISOString()` on write, so string values must be turned back into
 * `Date` before they reach an insert/update. `null`/`undefined` pass through unchanged.
 */
export const toDate = <T extends Date | string | null | undefined>(
  value: T,
): T extends string ? Date : T => (typeof value === 'string' ? new Date(value) : value) as never;
