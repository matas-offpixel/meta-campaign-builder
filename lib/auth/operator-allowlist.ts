/**
 * Operators allowed to approve live D2C scheduled sends (Mailchimp Phase 1).
 *
 * TODO: Matas — add your Supabase `auth.users.id` value(s) here after deploy.
 */

export const MATAS_USER_IDS: string[] = [];

export function isD2CApprover(userId: string): boolean {
  return MATAS_USER_IDS.includes(userId);
}
