/**
 * lib/audiences/event-source-permission.ts
 *
 * Recognising — and acting on — Meta's "no permission for event source" refusal
 * when creating a page-based custom audience.
 *
 * Dependency-free on purpose (no `server-only`, no Graph client) so the write
 * path, the preflight and the unit tests all share ONE definition of what this
 * failure is and which sources caused it.
 *
 * ── What the failure actually is (empirically established 2026-07-28) ────────
 * Subcode 1713140 means: THE TOKEN HOLDS NO PAGE-LEVEL ROLE ON THAT SEED PAGE.
 * It is not a business-ownership condition, not a token-scope condition, and not
 * a missing page "audience" task (no such task exists — see lib/bm/page-tasks.ts
 * and PR #727). The evidence, all captured live against Graph v23.0:
 *
 *   1. Same operator token, same ad account, same payload, two different seed
 *      pages: the page the operator holds a role on CREATED successfully; the
 *      page it holds no role on failed with 2654/1713140. One token cannot
 *      simultaneously have and lack a scope, so it is per-page authorisation.
 *   2. Granting the operator plain `ADVERTISE` on the failing page made the
 *      identical create succeed. `FULL_CONTROL` is not required.
 *   3. The failing page is a CLIENT page of a different business than the one
 *      owning the ad account, and the control page is too — so "the seed must be
 *      owned by the ad account's business" is false.
 *   4. Population check across every page-based audience ever written: of 117
 *      seed slots on audiences that reached `ready`, ZERO were pages where the
 *      operator lacked a role. Every no-role seed page appears only in failures.
 *
 * Fixtures: `__tests__/fixtures/event_source_permission_1713140.json` (the
 * refusal) and `event_source_permission_remediation.json` (the grant-and-retry
 * proof, including its own reversal).
 *
 * ── Why the ID parser matters ────────────────────────────────────────────────
 * Meta NAMES the offending sources in the message text. That single detail is
 * what makes a graceful fallback possible: a multi-page audience is built
 * atomically, so one unauthorised seed kills the whole create — but if we can
 * read which seed it was, we can grant access to it, or drop just that seed and
 * keep the audience, instead of losing all of them. The recorded 2026-07-27
 * failures cost 3 seed pages that were perfectly usable, purely because they
 * shared an audience with one page that was not.
 */

/**
 * "No permission for event source: Audience creation permission is missing for
 * one or more event sources (ID: …)" — code 2654, subcode 1713140.
 */
export const EVENT_SOURCE_PERMISSION_SUBCODE = 1713140;

/**
 * The older, vaguer refusal ("Permissions error", code 200 subcode 1713153) that
 * the PR #425 prefilter was built around. Recorded twice on 2026-05-20 before
 * that prefilter shipped. It carries NO source id in the message, so it can be
 * detected but never attributed to a specific seed — which is exactly why 1713140
 * is the one worth building a fallback on.
 */
export const LEGACY_PERMISSION_SUBCODE = 1713153;

/** Duck-typed so this module never imports MetaApiError (keeps it test-friendly). */
interface MetaErrorLike {
  message?: unknown;
  code?: unknown;
  subcode?: unknown;
  error_subcode?: unknown;
}

function asMetaErrorLike(err: unknown): MetaErrorLike | null {
  if (!err || typeof err !== "object") return null;
  return err as MetaErrorLike;
}

function subcodeOf(err: unknown): number | null {
  const e = asMetaErrorLike(err);
  if (!e) return null;
  // MetaApiError exposes `subcode`; a raw Graph body uses `error_subcode`.
  const raw = typeof e.subcode === "number" ? e.subcode : e.error_subcode;
  return typeof raw === "number" ? raw : null;
}

function messageOf(err: unknown): string {
  const e = asMetaErrorLike(err);
  if (e && typeof e.message === "string") return e.message;
  return err instanceof Error ? err.message : String(err ?? "");
}

/**
 * Is this the attributable event-source permission refusal (1713140)?
 *
 * Matched on subcode first. The message is only consulted as a fallback for
 * transports that lose the subcode (the launch path formats errors into a single
 * string before some callers see them), and then only on Meta's own distinctive
 * wording — deliberately not on the bare word "permission", which would swallow
 * unrelated failures.
 */
export function isEventSourcePermissionError(err: unknown): boolean {
  if (subcodeOf(err) === EVENT_SOURCE_PERMISSION_SUBCODE) return true;
  const msg = messageOf(err);
  return (
    msg.includes(String(EVENT_SOURCE_PERMISSION_SUBCODE)) ||
    /no permission for event source/i.test(msg) ||
    /audience creation permission is missing/i.test(msg)
  );
}

/** Either permission refusal — used where attribution is not needed. */
export function isAnyAudiencePermissionError(err: unknown): boolean {
  return isEventSourcePermissionError(err) || subcodeOf(err) === LEGACY_PERMISSION_SUBCODE;
}

/**
 * Pull the offending event-source ids out of Meta's message.
 *
 * Observed shape (verbatim): `… one or more event sources (ID: 260956420427418).`
 * The wording says "one or more", so a comma/space separated list is parsed even
 * though only single ids have been observed so far — a list would otherwise be
 * silently truncated to nothing, and the caller would drop no seeds at all.
 *
 * Returns [] when nothing parseable is present. Callers MUST treat an empty
 * result as "Meta refused but would not say which source", never as "no problem":
 * that is the difference between a graceful fallback and dropping every seed.
 */
export function parseOffendingEventSourceIds(err: unknown): string[] {
  const msg = messageOf(err);
  const out: string[] = [];
  // Meta has used both "(ID: x)" and "(IDs: x, y)"; accept either, plus the
  // trailing-period form.
  const groups = msg.matchAll(/\(IDs?:\s*([0-9][0-9,\s]*)\)/gi);
  for (const g of groups) {
    for (const id of g[1].split(/[,\s]+/)) {
      const trimmed = id.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

export interface SeedSplit {
  /** Seeds Meta did not complain about, in the caller's original order. */
  keep: string[];
  /** Seeds Meta named as unauthorised, in the caller's original order. */
  drop: string[];
}

/**
 * Split a requested seed set using the ids Meta named.
 *
 * Ids Meta names that were not in the request are ignored rather than trusted:
 * if Meta ever reports a source we did not send (a linked IG account behind a
 * page, say), dropping something we never requested would be meaningless, and
 * treating the response as authoritative over our own request would be worse.
 */
export function splitSeedsByOffendingIds(requested: string[], offending: string[]): SeedSplit {
  const bad = new Set(offending);
  const keep: string[] = [];
  const drop: string[] = [];
  for (const id of requested) {
    if (bad.has(id)) drop.push(id);
    else keep.push(id);
  }
  return { keep, drop };
}

/**
 * Operator-facing explanation of a 1713140 refusal.
 *
 * Names the pages, says what is actually wrong (no page role — not a business or
 * token problem), and states the one action that fixes it. Written against the
 * live finding so the operator is not sent to check things that are already ruled
 * out.
 */
export function describeEventSourcePermissionFailure(
  offending: string[],
  names: Record<string, string> = {},
): string {
  const labelled = offending.map((id) => (names[id] ? `${names[id]} (${id})` : id));
  const subject =
    labelled.length === 0
      ? "One of the selected sources"
      : labelled.length === 1
        ? labelled[0]
        : `${labelled.length} sources: ${labelled.join(", ")}`;
  return (
    `${subject} cannot be used as an audience source: your Facebook user holds no ` +
    `role on it. Being in the client's Business Manager is not sufficient — the ` +
    `role has to be on your user. Granting ADVERTISE on the page fixes it ` +
    `(Business Managers → Pages → Grant), after which the audience can be retried.`
  );
}
