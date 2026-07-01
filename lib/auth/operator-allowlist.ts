/**
 * Operators allowed to approve live D2C scheduled sends (Mailchimp Phase 1).
 *
 * Populated 2026-07-01 after the Jackies Mallorca live trial confirmed the
 * approver flow was blocked by an empty allowlist. Add new operator UUIDs
 * here as needed.
 *
 * Typed `readonly string[]` (not `as const`) — a literal tuple type would
 * narrow `.includes()` to only accept that exact string literal, which
 * `isD2CApprover(userId: string)` below can never satisfy.
 */
export const MATAS_USER_IDS: readonly string[] = [
  'b3ee4e5c-44e6-4684-acf6-efefbecd5858', // matas@offpixel.co.uk
];

export function isD2CApprover(userId: string): boolean {
  return MATAS_USER_IDS.includes(userId);
}
