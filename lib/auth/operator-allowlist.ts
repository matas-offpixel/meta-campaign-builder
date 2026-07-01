/**
 * Operators allowed to approve live D2C scheduled sends (Mailchimp Phase 1).
 *
 * Populated 2026-07-01 after Jackies Mallorca live-trial confirmed the approver
 * flow was blocked by an empty allowlist. Add new operator UUIDs here as needed.
 */

export const MATAS_USER_IDS: string[] = [
  'b3ee4e5c-44e6-4684-acf6-efefbecd5858', // matas@offpixel.co.uk
];

export function isD2CApprover(userId: string): boolean {
  return MATAS_USER_IDS.includes(userId);
}
