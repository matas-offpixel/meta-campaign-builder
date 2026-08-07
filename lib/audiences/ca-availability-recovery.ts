/**
 * lib/audiences/ca-availability-recovery.ts
 *
 * Recognising — and salvaging — Meta's "this ad set is using one or more
 * custom audiences, which are no longer available" refusal on ad set
 * creation (code 100 / subcode 1359207).
 *
 * Dependency-free on purpose (no Graph client, no `server-only`) so the
 * decision logic can be unit-tested exhaustively offline. Live wiring
 * (creating the ad set, batch-checking audience status) lives in
 * `app/api/meta/launch-campaign/route.ts`.
 *
 * ── Reproducer (task #115) ───────────────────────────────────────────────
 * East End Dubs Newcastle signup campaign (act 606252931141334, campaign
 * 120251192078210755), 2026-08-07: the "Similar Pages" ad set (a page_group
 * with a 10-page seed and 40+ engagement custom audiences) was rejected
 * outright because at least one of its custom audiences had aged out on
 * Meta's side. Meta builds ad set targeting atomically — one stale CA kills
 * the WHOLE ad set — so the operator had to manually diff 40+ audience IDs
 * against Meta's UI to find the offending one(s) before every relaunch.
 *
 * ── Why a ladder, and why it differs from PR #729 ────────────────────────
 * PR #729's event-source-permission refusal (subcode 1713140) has a "fix"
 * step — grant the missing role and retry unchanged — because the audience
 * still exists and access can be repaired. A deleted/unavailable custom
 * audience cannot be un-deleted, so there is no equivalent fix step here:
 * the ladder is SALVAGE (drop the stale audience, keep the rest) → EXPLAIN
 * (fail with the real cause when nothing can be salvaged).
 *
 * Meta sometimes — not always — names the offending audience verbatim in
 * the error message, the same "(ID: x)" / "(IDs: x, y)" convention as the
 * 1713140 refusal (see `parseOffendingCustomAudienceIds`). When it does not,
 * the caller batch-checks every requested audience's `delivery_status` /
 * `operation_status` via Meta's multi-object GET (see
 * `fetchCustomAudienceAvailability` in `lib/meta/client.ts`) and passes the
 * result in as `availabilityStatuses` — this module never calls Graph
 * itself, so that check is entirely up to the caller.
 */

/** Duck-typed so this module never imports MetaApiError (keeps it test-friendly). */
interface MetaErrorLike {
  message?: unknown;
  code?: unknown;
  subcode?: unknown;
  error_subcode?: unknown;
  userMsg?: unknown;
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
  const parts: string[] = [];
  if (e && typeof e.message === "string") parts.push(e.message);
  if (e && typeof e.userMsg === "string") parts.push(e.userMsg);
  if (parts.length > 0) return parts.join(" — ");
  return err instanceof Error ? err.message : String(err ?? "");
}

/**
 * "This ad set is using one or more custom audiences, which are no longer
 * available. You'll need to remove these unavailable audiences to publish
 * this ad set." — code 100, subcode 1359207.
 */
export const DELETED_CUSTOM_AUDIENCE_SUBCODE = 1359207;

/**
 * Is this Meta's "custom audience no longer available" refusal?
 *
 * Matched on subcode first; the message match is a fallback for transports
 * that lose the subcode (the launch path formats some errors into a single
 * string before certain callers see them), and is deliberately anchored to
 * Meta's own distinctive wording rather than the bare word "audience".
 */
export function isDeletedCustomAudienceError(err: unknown): boolean {
  if (subcodeOf(err) === DELETED_CUSTOM_AUDIENCE_SUBCODE) return true;
  const msg = messageOf(err);
  return (
    msg.includes(String(DELETED_CUSTOM_AUDIENCE_SUBCODE)) ||
    (/no longer available/i.test(msg) && /custom audience/i.test(msg)) ||
    /unavailable audiences/i.test(msg)
  );
}

/**
 * Pull any custom-audience ids Meta named verbatim out of the error message.
 *
 * Observed 1359207 wording does not name ids in the East End Dubs capture
 * (see `ca_deleted_1359207.json`), but Meta uses the "(ID: x)" / "(IDs: x, y)"
 * convention across many error families (see the 1713140 event-source
 * refusal this mirrors), so this stays ready for a future wording variant
 * that does. Returns [] when nothing parseable is present — callers MUST
 * treat that as "unattributed", never as "nothing wrong": that is the
 * difference between a graceful drop and silently keeping a dead audience.
 */
export function parseOffendingCustomAudienceIds(err: unknown): string[] {
  const msg = messageOf(err);
  const out: string[] = [];
  const groups = msg.matchAll(/\(IDs?:\s*([0-9][0-9,\s]*)\)/gi);
  for (const g of groups) {
    for (const id of g[1].split(/[,\s]+/)) {
      const trimmed = id.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

export interface CustomAudienceAvailabilityStatus {
  id: string;
  /**
   * True when this audience is safe to keep targeting. False when Meta's
   * `delivery_status`/`operation_status` (or its absence from a batch GET
   * response) marks it deleted/unavailable — see
   * `fetchCustomAudienceAvailability` in `lib/meta/client.ts`.
   */
  available: boolean;
}

export interface RecoverFromDeletedCaInput {
  /** Every custom-audience id currently in this ad set's targeting, in order. */
  requestedIds: string[];
  /** The error Meta returned creating (or re-creating) the ad set. */
  error: unknown;
  /**
   * Pre-fetched availability for `requestedIds`, supplied by the caller ONLY
   * when Meta's message named no offending id (a live batch-status check is
   * a Graph call, which this module deliberately does not make itself). Omit
   * when the message already named the offending id(s) — no need to spend a
   * status-check call to confirm what Meta already told us.
   */
  availabilityStatuses?: CustomAudienceAvailabilityStatus[];
  /** id → display name for operator-facing messages. */
  names?: Record<string, string>;
}

export interface RecoverFromDeletedCaResult {
  /** False when `error` is not a 1359207 refusal — caller should rethrow it untouched. */
  recognised: boolean;
  /** Ids to retry with — pass straight into a rebuilt `targeting.custom_audiences`. */
  keepIds: string[];
  /** Ids identified as unavailable and excluded from `keepIds`. */
  dropIds: string[];
  /** Non-fatal operator-facing note for `adSetsCreated[].note` — null on nothing salvaged. */
  note: string | null;
  /**
   * Set when recognised but nothing could be launched: either no offending
   * id could be identified (message silent AND no availability check ran /
   * the check found nothing), or every requested audience turned out to be
   * unavailable. Callers should fail the ad set with this message rather
   * than retry with an empty or unchanged audience list.
   */
  unrecoverable?: string;
}

/**
 * Decide what to keep/drop after a 1359207 refusal. Pure and synchronous —
 * callers own the retry (`createMetaAdSet` with the reduced targeting) and,
 * when needed, the availability check that feeds `availabilityStatuses`.
 */
export function recoverFromDeletedCa(input: RecoverFromDeletedCaInput): RecoverFromDeletedCaResult {
  if (!isDeletedCustomAudienceError(input.error)) {
    return { recognised: false, keepIds: input.requestedIds, dropIds: [], note: null };
  }

  const named = parseOffendingCustomAudienceIds(input.error);
  const offending =
    named.length > 0
      ? named
      : (input.availabilityStatuses ?? []).filter((s) => !s.available).map((s) => s.id);

  if (offending.length === 0) {
    return {
      recognised: true,
      keepIds: input.requestedIds,
      dropIds: [],
      note: null,
      unrecoverable:
        "Meta rejected this ad set for using unavailable custom audiences, but did not " +
        "name which one(s), and a status check found none stale. Remove and re-add the " +
        "audiences on this ad set's page group manually to find the offending one.",
    };
  }

  const bad = new Set(offending);
  const keepIds = input.requestedIds.filter((id) => !bad.has(id));
  const dropIds = input.requestedIds.filter((id) => bad.has(id));

  if (keepIds.length === 0) {
    return {
      recognised: true,
      keepIds,
      dropIds,
      note: null,
      unrecoverable:
        `All ${dropIds.length} targeted custom audience${dropIds.length === 1 ? "" : "s"} ` +
        `${dropIds.length === 1 ? "is" : "are"} unavailable (${labelList(dropIds, input.names)}) ` +
        `— nothing left to target.`,
    };
  }

  return {
    recognised: true,
    keepIds,
    dropIds,
    note:
      `Launched without ${dropIds.length} unavailable audience${dropIds.length === 1 ? "" : "s"} ` +
      `(${labelList(dropIds, input.names)}).`,
  };
}

function labelList(ids: string[], names: Record<string, string> = {}): string {
  return ids.map((id) => (names[id] ? `${names[id]} (${id})` : id)).join(", ");
}
