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

/**
 * Agency operators: the proxy's /api gate (lib/auth/api-access.ts), the
 * optimisation and automation controls, cross-client reads. Wider than
 * MATAS_USER_IDS, which stays the list for what acts as Matas himself:
 * live D2C approval (`isD2CApprover`), the Business Manager tool (his
 * Facebook token) and WhatsApp communities.
 */
export const OPERATOR_USER_IDS: readonly string[] = [
  ...MATAS_USER_IDS,
  '4aa59005-5c1d-495c-8029-8c9453950c4d', // agency staff account, added 16 Nov 2026 on Matas's word
];

export function isOperator(userId: string): boolean {
  return OPERATOR_USER_IDS.includes(userId);
}
