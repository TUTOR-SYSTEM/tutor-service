/**
 * Acting identity forwarded by the gateway with every tutor-domain call (CONTRACT C4):
 * `userId` and `role` come from the verified JWT, never from a request body.
 */
export type ActorRef = { userId: string; role?: string | null };

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'ADMIN';
}

/**
 * Ownership gate for owner-scoped records (`tutorId` / `userId`). ADMIN bypasses ownership;
 * everyone else must be the owner. A missing actor role is treated as non-admin (fail closed).
 */
export function canActOnOwned(actor: ActorRef, ownerId: string | null | undefined): boolean {
  if (isAdminRole(actor.role)) return true;
  return !!ownerId && !!actor.userId && ownerId === actor.userId;
}
