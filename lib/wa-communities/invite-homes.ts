/**
 * The two homes of a community invite code.
 *
 * Authoritative: wa_community_alias_destinations.invite_code where is_active.
 * Cache: wa_community_aliases.active_invite_code.
 *
 * They agree when both are null (no active destination) or both hold the
 * same code. Null matches null, the same way Postgres `is not distinct from`
 * does. The deferred trigger assert_wa_alias_invite_homes enforces this in
 * the database; this function is the same predicate for tests and for the
 * post-write reload check.
 */
export function inviteHomesAgree(
  cache: string | null | undefined,
  activeDestination: string | null | undefined,
): boolean {
  return (cache ?? null) === (activeDestination ?? null);
}
