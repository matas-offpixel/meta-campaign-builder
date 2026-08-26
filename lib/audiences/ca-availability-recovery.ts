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
 *
 * ── task #123 — reactive salvage doesn't loop, and reveals in batches ────
 * IPC Newcastle Signup v3 launch, 2026-08-07 21:11 UTC (campaign
 * 120251198620030755, trace AV0qQKsugcBE0TibyVrynl2): the "Similar Pages"
 * ad set (40 engagement audiences) was rejected with 1359207, the caller's
 * `fetchCustomAudienceAvailability` check found 11 unavailable, the salvage
 * retry dropped them and re-submitted the remaining 29 — which Meta ALSO
 * rejected with 1359207 (a second, different batch of stale ids among the
 * remaining 29). The single-pass caller had no second recovery attempt, so
 * the ad set hard-failed instead of looping. `recoverFromDeletedCa` itself
 * doesn't need to loop — it's a stateless one-shot decision function — but
 * the CALLER (`launch-campaign/route.ts`) now wraps it in a bounded retry
 * loop (max 4 passes), re-running the same availability check + this
 * function against the shrinking `requestedIds` set each pass. See
 * `preflightDropUnavailableAudiences` below for the complementary FIX: for
 * ad sets with a large (≥20) REUSED custom-audience count, check
 * availability proactively BEFORE the first `createMetaAdSet` call instead
 * of paying for N reactive salvage passes.
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
   * True when this audience is safe to keep targeting. False only when the
   * id is missing from a per-id GET, or Meta reports operation_status 411
   * (deleted) / 412 (unavailable) — the 1359207-class dead ids. Populating
   * (441) and non-200 delivery_status are NOT unavailable: Meta's 441
   * description is "You can start running ads with this audience straight
   * away." See `classifyCustomAudienceAvailability`.
   */
  available: boolean;
}

/** Meta operation_status: deleted. */
export const CA_OP_DELETED = 411;
/** Meta operation_status: unavailable. */
export const CA_OP_UNAVAILABLE = 412;
/** Meta operation_status: populating — valid for ad-set targeting. */
export const CA_OP_POPULATING = 441;
/** Meta operation_status: processing — short-lived; also valid for targeting. */
export const CA_OP_PROCESSING = 400;

export interface CustomAudienceStatusFields {
  id?: string;
  delivery_status?: { code: number; description?: string };
  operation_status?: { code: number; description?: string };
}

export interface ClassifiedCustomAudienceAvailability extends CustomAudienceAvailabilityStatus {
  deliveryStatusCode?: number;
  operationStatusCode?: number;
}

/**
 * Decide whether one custom audience is safe to put in ad-set targeting.
 *
 * This is a per-id verdict (the write path GETs `/{id}` — batched, never a
 * `/customaudiences` listing membership check). Absence from a listing page
 * is not an input and must never be treated as "dead".
 *
 * Dead (available=false):
 *   - `row` missing — Meta omits objects it considers gone
 *   - operation_status 411 (deleted) or 412 (unavailable)
 *
 * Alive (available=true), including the DJ EZ / code-441 shape:
 *   - operation_status 441 (populating) or 400 (processing), regardless of
 *     `delivery_status` — Meta says you can start running ads immediately
 *   - any other row Meta actually returned (delivery_status !== 200 is a
 *     readiness/size signal, not a delete)
 */
export function classifyCustomAudienceAvailability(
  id: string,
  row: CustomAudienceStatusFields | null | undefined,
): ClassifiedCustomAudienceAvailability {
  if (!row) {
    return { id, available: false };
  }
  const deliveryCode = row.delivery_status?.code;
  const opCode = row.operation_status?.code;
  if (opCode === CA_OP_DELETED || opCode === CA_OP_UNAVAILABLE) {
    return { id, available: false, deliveryStatusCode: deliveryCode, operationStatusCode: opCode };
  }
  return { id, available: true, deliveryStatusCode: deliveryCode, operationStatusCode: opCode };
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

export interface PreflightAvailabilityDropInput {
  /** Every custom-audience id currently in this ad set's targeting, in order. */
  requestedIds: string[];
  /**
   * Availability for the ids actually worth checking — the caller decides
   * WHICH ids to check (typically only "reused" ids, i.e. not created fresh
   * this launch run — see `waitForAudienceReady` in `lib/meta/client.ts` for
   * the fresh-audience race, a separate problem) and only bothers running
   * the batched Graph GET (`fetchCustomAudienceAvailability`) at all above
   * some size threshold where a wasted call is cheap insurance against a
   * multi-pass reactive salvage loop. Ids NOT present in this array are
   * assumed available (kept unconditionally) — this function never treats
   * "not checked" as "unavailable".
   */
  availabilityStatuses: CustomAudienceAvailabilityStatus[];
  /** id → display name for operator-facing messages. */
  names?: Record<string, string>;
}

export interface PreflightAvailabilityDropResult {
  /** Ids safe to submit on the FIRST `createMetaAdSet` attempt. */
  keepIds: string[];
  /** Ids proactively excluded because Meta already reports them unavailable. */
  dropIds: string[];
  /** Non-fatal operator-facing note for `adSetsCreated[].note` — null when nothing was dropped. */
  note: string | null;
}

/**
 * Proactively drop custom audiences Meta already reports as unavailable
 * (missing from a per-id GET, or operation_status 411/412 — see
 * `classifyCustomAudienceAvailability`) BEFORE the first `createMetaAdSet`
 * attempt, instead of discovering them reactively through the
 * `recoverFromDeletedCa` salvage loop above. Populating/441 is kept.
 *
 * Purely a keep/drop split on `availabilityStatuses` — no Meta error to
 * classify (nothing has failed yet), so unlike `recoverFromDeletedCa` this
 * never checks `isDeletedCustomAudienceError` or parses an error message.
 * Kept as a separate function rather than a `recoverFromDeletedCa` mode
 * switch because the two have genuinely different inputs (a real refusal
 * to interpret vs. a plain availability snapshot) and call sites (before
 * vs. after `createMetaAdSet`) — sharing only the trailing
 * keep/drop/label bookkeeping, which both delegate to `labelList`.
 *
 * task #123 — this is the "ask Meta upfront" half of the fix for launches
 * with a lot of REUSED engagement audiences (page_group ad sets built from
 * a long-running page_group tend to accumulate dozens across many past
 * launches): one batched Graph GET replaces what would otherwise cost
 * several `recoverFromDeletedCa` round trips (one Meta rejection + one
 * retry per newly-revealed batch of stale ids) on the first launch attempt
 * after any of them age out.
 */
/**
 * Below this many REUSED (non-fresh) custom audiences on one ad set, a
 * preflight availability check isn't worth its own Graph GET — the common
 * case (a handful of manually-picked audiences, or a page_group early in
 * its life) should never pay this cost. Exported so the caller's "is this
 * ad set big enough to bother" decision and this module's actual drop
 * logic share one source of truth and can be tested together.
 */
export const REUSED_CA_PREFLIGHT_THRESHOLD = 20;

/** Should the caller spend a batched availability GET before the first `createMetaAdSet` attempt? */
export function shouldRunPreflightAvailabilityCheck(
  reusedAudienceIds: string[],
  threshold: number = REUSED_CA_PREFLIGHT_THRESHOLD,
): boolean {
  return reusedAudienceIds.length >= threshold;
}

export function preflightDropUnavailableAudiences(
  input: PreflightAvailabilityDropInput,
): PreflightAvailabilityDropResult {
  const unavailableIds = new Set(
    input.availabilityStatuses.filter((s) => !s.available).map((s) => s.id),
  );
  if (unavailableIds.size === 0) {
    return { keepIds: input.requestedIds, dropIds: [], note: null };
  }

  const keepIds = input.requestedIds.filter((id) => !unavailableIds.has(id));
  const dropIds = input.requestedIds.filter((id) => unavailableIds.has(id));

  return {
    keepIds,
    dropIds,
    note:
      `Launched without ${dropIds.length} unavailable audience${dropIds.length === 1 ? "" : "s"} ` +
      `(${labelList(dropIds, input.names)}) — dropped proactively before the first create attempt.`,
  };
}
