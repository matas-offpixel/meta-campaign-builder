/**
 * Pure resolve logic for /j/{segment}.
 *
 * Lookup order (see product brief):
 *   1. If the segment is a valid slug, try the alias table.
 *   2. Alias hit + active + has destination → redirect there.
 *   3. Alias hit but inactive / no destination → 404.
 *   4. No alias + valid invite code → passthrough (legacy templates).
 *   5. Valid slug shape but unknown, and not an invite → 404.
 *   6. Otherwise → 400 invalid.
 */

import { isValidInviteCode, isValidSlug } from "./slug.ts";

export type AliasLookupRow = {
  is_active: boolean;
  active_invite_code: string | null;
};

export type ResolveOutcome =
  | {
      kind: "alias";
      status: 302;
      slug: string;
      inviteCode: string;
    }
  | {
      kind: "passthrough";
      status: 302;
      inviteCode: string;
    }
  | { kind: "not_found"; status: 404 }
  | { kind: "invalid"; status: 400 };

/**
 * Resolve a path segment given an optional alias row from the DB.
 * `alias` is null when no row matched the slug (or the segment was not
 * slug-shaped and we skipped the lookup).
 */
export function resolveInviteSegment(
  segment: string,
  alias: AliasLookupRow | null,
): ResolveOutcome {
  if (isValidSlug(segment)) {
    if (alias) {
      if (!alias.is_active || !alias.active_invite_code) {
        return { kind: "not_found", status: 404 };
      }
      if (!isValidInviteCode(alias.active_invite_code)) {
        return { kind: "not_found", status: 404 };
      }
      return {
        kind: "alias",
        status: 302,
        slug: segment,
        inviteCode: alias.active_invite_code,
      };
    }
    // Unknown slug — fall through to invite passthrough when the segment
    // also looks like a raw invite (all-lowercase 8–30 alnum).
    if (isValidInviteCode(segment)) {
      return { kind: "passthrough", status: 302, inviteCode: segment };
    }
    return { kind: "not_found", status: 404 };
  }

  if (isValidInviteCode(segment)) {
    return { kind: "passthrough", status: 302, inviteCode: segment };
  }

  return { kind: "invalid", status: 400 };
}

export function whatsappCommunityRedirectUrl(inviteCode: string): string {
  return `https://chat.whatsapp.com/${inviteCode}?mode=gi_t`;
}
