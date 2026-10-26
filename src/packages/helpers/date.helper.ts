/**
 * RPC payloads are JSON, so a `Date` sent from gateway arrives as an ISO string. Prisma
 * accepts ISO strings for `DateTime`, but repositories normalise to real `Date` objects before an
 * insert/update (and before comparing in a `where`) so behaviour doesn't depend on that. `null`/`undefined` pass through unchanged.
 */
export const toDate = <T extends Date | string | null | undefined>(
  value: T,
): T extends string ? Date : T => (typeof value === 'string' ? new Date(value) : value) as never;
