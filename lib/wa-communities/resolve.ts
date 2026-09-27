/**
 * Pure resolve logic for /j/{segment}.
 *
 * Lookup order:
 *   1. Segment matches neither the slug shape nor an invite code → 404.
 *   2. Lookup returned an authoritative destination code → redirect there.
 *   3. Otherwise (no alias, inactive alias, lookup failed open) → passthrough
 *      to chat.whatsapp.com/{segment} with the segment bytes unchanged.
 *
 * The destination code comes from wa_community_alias_destinations (the
 * active row). aliases.active_invite_code is a cache and is not read here.
 */

import { isValidInviteCode, isWellFormedSegment } from "./slug.ts";

/**
 * Destination code the public redirect is allowed to follow.
 * Inactive aliases and rows with no active destination yield null so the
 * segment passes through. The cache column is not consulted.
 */
export function authoritativeDestination(
  row: {
    is_active: boolean;
    destinations: { invite_code: string; is_active: boolean }[];
  } | null,
): string | null {
  if (!row?.is_active) return null;
  const active = row.destinations.find((d) => d.is_active);
  if (!active || !isValidInviteCode(active.invite_code)) return null;
  return active.invite_code;
}

export type AliasLookupRow = {
  /** Active destination invite code. Null when there is nothing to follow. */
  destination_invite_code: string | null;
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
  | { kind: "not_found"; status: 404 };

/**
 * Resolve a path segment given an optional alias lookup.
 * `alias` is null when no destination is in force (no row, inactive alias,
 * or the lookup failed open and the caller passed null).
 */
export function resolveInviteSegment(
  segment: string,
  alias: AliasLookupRow | null,
): ResolveOutcome {
  if (!isWellFormedSegment(segment)) {
    return { kind: "not_found", status: 404 };
  }

  const code = alias?.destination_invite_code ?? null;
  if (code && isValidInviteCode(code)) {
    return {
      kind: "alias",
      status: 302,
      slug: segment,
      inviteCode: code,
    };
  }

  return { kind: "passthrough", status: 302, inviteCode: segment };
}

export function whatsappCommunityRedirectUrl(inviteCode: string): string {
  return `https://chat.whatsapp.com/${inviteCode}?mode=gi_t`;
}
