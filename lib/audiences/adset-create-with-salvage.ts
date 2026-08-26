/**
 * lib/audiences/adset-create-with-salvage.ts
 *
 * Single source of truth for the ad-set-create salvage ladder that
 * `app/api/meta/launch-campaign/route.ts` runs after a `createMetaAdSet`
 * call fails. Originally built up incrementally, directly inside the
 * standard wizard launch's Phase 2 (tasks #115/#116/#122/#123/#124):
 *
 *   1. Subcode 1359207 ("custom audience no longer available") — looped
 *      salvage (up to 4 passes) via `recoverFromDeletedCa`, falling back
 *      to a "recreate every engagement audience for this page group from
 *      scratch" attempt when Meta's create-time validator disagrees with
 *      its own availability read endpoint even after every "clean"
 *      survivor has been re-checked (task #124 — "Meta lies").
 *   2. Subcode 1870196 ("invalid targeting automation type") — retry with
 *      Advantage+ Audience stripped and `targeting_automation` REPLACED
 *      (never deleted — see task #124's fix) with an explicit
 *      `{ advantage_audience: 0 }`.
 *   3. Subcode 1870227 ("missing advantage_audience flag") — retry with
 *      the flag forced explicitly per `adSet.advantagePlus`.
 *   4. Fallthrough diagnostic — logs `code`/`subcode`/`message` for any
 *      Meta error none of the above recognised, so a future refusal (or a
 *      classifier that stops matching because Meta changed wording) is
 *      visible directly in prod logs.
 *
 * task #125 extracted this ladder out of the standard Phase 2 closure into
 * this dependency-injected module so the multi-campaign bulk-attach path
 * (`MC[${ci}] Phase 2`/`Phase 2b` in the same route file — what "Confirm &
 * Launch" from the Asset Queue actually runs) can call the EXACT same
 * decision logic instead of re-implementing (and inevitably drifting
 * from) a parallel copy. Both `Phase 2b` (standard) and `MC[...] Phase 2`/
 * `Phase 2b` previously had zero, or only a subset, of tiers 1–4 above —
 * this module is now the only place any of them live.
 *
 * ── Deliberately NOT covered here ────────────────────────────────────────
 * Deprecated-interest retry (subcode 1870247, `extractDeprecatedReplacements`
 * / `applyInterestReplacements`) stays at each call site: it needs to
 * intercept the FIRST `createMetaAdSet` failure before this module ever
 * sees it (this module is only invoked when that check does not apply),
 * and its rich bookkeeping (`interestReplacements`, `launchRetryAttempted`,
 * etc.) is specific to the standard wizard launch's summary. Composing the
 * two is safe because the subcodes are mutually exclusive in practice — an
 * error this module doesn't recognise (including 1870247) is rethrown
 * unchanged after the fallthrough log, so a caller's OWN interest-dep
 * check downstream still sees the original error untouched.
 *
 * ── Why this file has zero VALUE imports from lib/meta/client.ts ─────────
 * `MetaApiError` there uses TS parameter-property class syntax, which
 * `node --experimental-strip-types` cannot parse (see
 * lib/meta/error-classify.ts's doc comment for the identical constraint).
 * Every Meta API call (`createMetaAdSet`, `fetchCustomAudienceAvailability`,
 * the engagement-audience recreate) is taken as an injected dependency so
 * this module — and its test suite — never load client.ts at runtime.
 * TYPE-ONLY imports from client.ts are fine (erased before strip-types
 * ever sees them).
 */

import type { AdSetSuggestion, EngagementType, PageAudienceGroup } from "@/lib/types";
import type { MetaAdSetPayload } from "../meta/adset.ts";
import type { AudienceReadinessWaitResult, CustomAudienceAvailability } from "../meta/client.ts";
import {
  isDeletedCustomAudienceError,
  parseOffendingCustomAudienceIds,
  preflightDropUnavailableAudiences,
  recoverFromDeletedCa,
  shouldRunPreflightAvailabilityCheck,
} from "./ca-availability-recovery.ts";
import { isInvalidTargetingAutomationError, isMissingAdvantageAudienceFlagError } from "../meta/error-classify.ts";

/** Bounded so a launch can never loop forever chasing newly-revealed batches of stale audiences — see task #123. */
const MAX_CA_SALVAGE_PASSES = 4;

function messageOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return err instanceof Error ? err.message : String(err ?? "");
}

/** Duck-typed Meta-error shape check for the fallthrough diagnostic — no `instanceof MetaApiError` (see module doc). */
function isMetaErrorLike(
  err: unknown,
): err is { code?: number; subcode?: number; message?: string } {
  return !!err && typeof err === "object" && ("subcode" in err || "code" in err) && "message" in err;
}

export interface RecreateEngagementAudiencesResult {
  ids: string[];
  created: { name: string; id: string; type: EngagementType; pageId: string; pageName: string }[];
  failed: { name: string; type: EngagementType; error: string }[];
}

export interface CreateAdSetWithSalvageDeps {
  createMetaAdSet: (adAccountId: string, payload: MetaAdSetPayload, token?: string) => Promise<{ id: string }>;
  fetchCustomAudienceAvailability: (ids: string[], token?: string) => Promise<CustomAudienceAvailability[]>;
  /**
   * Forced fresh re-creation of every engagement audience for one page
   * group (task #124's "meta lies" tier). Callers close over whatever
   * context (`supabase`, `userId`, `adAccountId`, `userFbToken`,
   * `pageToIg`, `pageNameMap`, engagement labels) their own
   * `recreateEngagementAudiencesForGroup` needs — it doesn't vary per
   * ad set, or (in the multi-campaign path) per attached campaign, so one
   * closure built once per launch is enough for every call site.
   */
  recreateEngagementAudiencesForGroup: (group: PageAudienceGroup) => Promise<RecreateEngagementAudiencesResult>;
  /** Formats any thrown error (Meta or generic) into a human-readable string for logs — callers already have `formatMetaError`. */
  formatError: (err: unknown) => string;
}

export interface PrepareAdSetPayloadParams {
  adSet: AdSetSuggestion;
  /** Already built (buildAdSetPayload + any placement/interest adjustments the caller applies). */
  payload: MetaAdSetPayload;
  /**
   * Ids created THIS launch run, before this ad set's own creation phase
   * started — used to decide which referenced audiences are worth a
   * readiness wait (task #122) vs. a preflight availability check (task
   * #123). Callers in the multi-campaign path should pass a PER-CAMPAIGN
   * clone (see the route's `campaignFreshIds`), not the shared base set
   * directly — see the module doc on scoping.
   */
  freshlyCreatedEngagementAudienceIds: Set<string>;
  /**
   * Ids this launch already holds a creation (or reuse) receipt for —
   * Phase 1.5 just created them, or just read them back from Meta on the
   * reuse branch. Trusted without an availability listing/lookup: the write
   * already has the Meta id. Includes `freshlyCreatedEngagementAudienceIds`
   * plus reused-this-run receipts. Does NOT trigger the 30s readiness wait
   * (that's only for brand-new creates).
   */
  receiptAudienceIds?: Set<string>;
  /** id → display name, for legible wait/drop log lines and notes. */
  audienceNameById: Map<string, string>;
  getOrWaitAudienceReady: (audienceId: string) => Promise<AudienceReadinessWaitResult>;
  launchToken?: string;
  /** e.g. "Phase 2", "Phase 2b", "MC[3] Phase 2", "MC[3] Phase 2b" — prefixes every log line. */
  logPrefix: string;
}

export interface PrepareAdSetPayloadResult {
  /** Possibly preflight-adjusted (custom_audiences trimmed) — pass this, not the original, into the first createMetaAdSet attempt. */
  payload: MetaAdSetPayload;
  /** Outcome of waiting on any freshly-created ids this ad set references — feed into createAdSetWithSalvage's availability overlay if the first attempt still fails with 1359207. */
  freshReadinessResults: Map<string, AudienceReadinessWaitResult>;
  preflightDroppedCount: number;
  preflightDroppedNote?: string;
}

/**
 * Pre-create step: readiness-wait for freshly-created audiences (task
 * #122) + preflight availability check for large REUSED-audience ad sets
 * (task #123) + the hard 0-budget guard (task #122 FIX 3 — Meta subcode
 * 1885272). Run this once per ad set, BEFORE the first `createMetaAdSet`
 * attempt; feed its result into that attempt and, if it fails, into
 * `createAdSetWithSalvage` below.
 *
 * Throws a plain `Error` when `payload.daily_budget` is missing or <= 0 —
 * callers should let this propagate (or wrap it in whatever failure shape
 * their own call site uses) rather than ever reaching Meta with it.
 */
export async function prepareAdSetPayloadForCreate(
  params: PrepareAdSetPayloadParams,
  deps: Pick<CreateAdSetWithSalvageDeps, "fetchCustomAudienceAvailability">,
): Promise<PrepareAdSetPayloadResult> {
  const {
    adSet,
    freshlyCreatedEngagementAudienceIds,
    receiptAudienceIds,
    audienceNameById,
    getOrWaitAudienceReady,
    launchToken,
    logPrefix,
  } = params;
  let payload = params.payload;
  const customAudIds = (payload.targeting.custom_audiences ?? []).map((a) => a.id);
  const trustedIds = new Set<string>([
    ...freshlyCreatedEngagementAudienceIds,
    ...(receiptAudienceIds ?? []),
  ]);

  // ── task #122 FIX 1: wait out the freshly-created-audience race ──────────
  const freshReadinessResults = new Map<string, AudienceReadinessWaitResult>();
  const freshIdsToWaitOn = customAudIds.filter((id) => freshlyCreatedEngagementAudienceIds.has(id));
  if (freshIdsToWaitOn.length > 0) {
    console.log(
      `[launch-campaign] ${logPrefix} — "${adSet.name}" references ${freshIdsToWaitOn.length}` +
        ` freshly-created audience(s); waiting up to 30s for readiness: ` +
        freshIdsToWaitOn.map((id) => `${id} (${audienceNameById.get(id) ?? "?"})`).join(", "),
    );
    const waited = await Promise.all(freshIdsToWaitOn.map((id) => getOrWaitAudienceReady(id)));
    for (const w of waited) {
      freshReadinessResults.set(w.id, w);
      console.log(
        `[launch-campaign] ${logPrefix} — readiness wait for ${w.id}:` +
          ` ready=${w.ready} timedOut=${w.timedOut} code=${w.finalCode ?? "n/a"} (${w.finalDescription ?? "n/a"})`,
      );
    }
  }

  // ── task #123 FIX 2: preflight availability check for reused audiences ───
  let preflightDroppedNote: string | undefined;
  let preflightDroppedCount = 0;
  const reusedCaIds = customAudIds.filter((id) => !trustedIds.has(id));
  if (shouldRunPreflightAvailabilityCheck(reusedCaIds)) {
    console.log(
      `[launch-campaign] ${logPrefix} — "${adSet.name}" targets ${reusedCaIds.length} reused custom` +
        ` audience(s) — running a preflight availability check before the first create attempt`,
    );
    const preflightStatuses = await deps.fetchCustomAudienceAvailability(reusedCaIds, launchToken ?? undefined);
    const preflight = preflightDropUnavailableAudiences({
      requestedIds: customAudIds,
      availabilityStatuses: preflightStatuses,
      names: audienceNameById.size > 0 ? Object.fromEntries(audienceNameById) : undefined,
    });
    if (preflight.dropIds.length > 0) {
      console.log(
        `[launch-campaign] ${logPrefix} — "${adSet.name}" — preflight dropped ${preflight.dropIds.length}` +
          ` unavailable audience(s) before the first create attempt: ${preflight.dropIds.join(", ")}`,
      );
      payload = {
        ...payload,
        targeting: { ...payload.targeting, custom_audiences: preflight.keepIds.map((id) => ({ id })) },
      };
      preflightDroppedNote = preflight.note ?? undefined;
      preflightDroppedCount = preflight.dropIds.length;
    }
  }

  // ── task #122 FIX 3: hard budget validation (Meta subcode 1885272) ───────
  if (!payload.daily_budget || payload.daily_budget <= 0) {
    throw new Error(`Ad set "${adSet.name}" has no budget — set a daily budget in Step 5.`);
  }

  return { payload, freshReadinessResults, preflightDroppedCount, preflightDroppedNote };
}

export interface CreateAdSetWithSalvageParams {
  adSet: AdSetSuggestion;
  /** The payload actually sent on the FIRST (already-failed) createMetaAdSet attempt — i.e. prepareAdSetPayloadForCreate's output. */
  initialPayload: MetaAdSetPayload;
  /** The error that first attempt threw. */
  initialError: unknown;
  adAccountId: string;
  launchToken?: string;
  logPrefix: string;
  /** `Date.now()` captured before the FIRST attempt, so returned `durationMs` covers the whole salvage sequence. */
  asStart: number;
  freshReadinessResults: Map<string, AudienceReadinessWaitResult>;
  preflightDroppedCount: number;
  audienceNameById: Map<string, string>;
  /** draft.audiences.pageGroups — mutated in place on a successful recreate-fallback so later ad sets referencing the same group pick up the fresh ids. */
  pageGroups: PageAudienceGroup[];
}

export interface CreateAdSetWithSalvageResult {
  metaAdSetId: string;
  durationMs: number;
  note?: string;
  /** Set to "strict" when the 1870196 salvage downgraded an Advantage+ ad set to manual ages — see the route's ageMode bookkeeping. */
  ageModeOverride?: "strict";
}

/**
 * Runs the full salvage ladder (tiers 1–4 — see module doc) against an
 * ALREADY-FAILED first `createMetaAdSet` attempt. Returns a result on any
 * successful retry; throws the underlying error (never re-shaped) when
 * nothing salvages it — callers wrap that in whatever failure shape their
 * own call site needs (`{ adSet, err }` for a `Promise.allSettled` map,
 * a plain catch for a sequential loop).
 */
export async function createAdSetWithSalvage(
  params: CreateAdSetWithSalvageParams,
  deps: CreateAdSetWithSalvageDeps,
): Promise<CreateAdSetWithSalvageResult> {
  const {
    adSet,
    initialPayload,
    initialError,
    adAccountId,
    launchToken,
    logPrefix,
    asStart,
    freshReadinessResults,
    preflightDroppedCount,
    audienceNameById,
    pageGroups,
  } = params;

  // ── Tier 1: subcode 1359207 — looped CA-availability salvage + "meta lies" recreate fallback ──
  if (isDeletedCustomAudienceError(initialError)) {
    const allDroppedIds: string[] = [];
    const allDroppedNames: Record<string, string> = {};
    let currentPayload = initialPayload;
    let currentErr: unknown = initialError;
    let hasAttemptedRecreateFallback = false;

    for (let pass = 1; pass <= MAX_CA_SALVAGE_PASSES; pass++) {
      const requestedCaIds = (currentPayload.targeting.custom_audiences ?? []).map((a) => a.id);
      const named = parseOffendingCustomAudienceIds(currentErr);
      let availabilityStatuses: CustomAudienceAvailability[] | undefined;
      const recoveryNames: Record<string, string> = {};
      if (named.length === 0 && requestedCaIds.length > 0) {
        const fetched = await deps.fetchCustomAudienceAvailability(requestedCaIds, launchToken ?? undefined);
        const byId = new Map(fetched.map((s) => [s.id, s] as const));
        // Overlay the pre-create readiness wait only for genuinely dead
        // outcomes (null / 411 / 412 / other terminal errors). 441
        // (populating) and 400 (processing) stay available — Meta's 441
        // text is "You can start running ads with this audience straight
        // away." Treating them as dead was the DJ EZ false negative.
        for (const [id, waited] of freshReadinessResults) {
          const populating = waited.finalCode === 441 || waited.finalCode === 400;
          if (!waited.ready && !populating) {
            byId.set(id, { id, available: false, operationStatusCode: waited.finalCode ?? undefined });
            const baseName = audienceNameById.get(id) ?? id;
            recoveryNames[id] = `${baseName} — unavailable (code ${waited.finalCode ?? "unknown"})`;
          }
        }
        availabilityStatuses = requestedCaIds.map((id) => byId.get(id) ?? { id, available: true });
      }

      const recovery = recoverFromDeletedCa({
        requestedIds: requestedCaIds,
        error: currentErr,
        availabilityStatuses,
        names: Object.keys(recoveryNames).length > 0 ? recoveryNames : undefined,
      });

      if (recovery.unrecoverable) {
        // task #124 (Similar Pages "meta lies" tier) — recoverFromDeletedCa
        // correctly gives up here, but ONLY once availability has ALREADY
        // been trusted-and-wrong once for this ad set (a prior preflight
        // or loop-pass drop) does that mean "Meta's create-time validator
        // disagrees with its own read endpoint" rather than e.g. a non-CA
        // error wrongly routed into this branch.
        const priorDropCount = preflightDroppedCount + allDroppedIds.length;
        if (
          !hasAttemptedRecreateFallback &&
          requestedCaIds.length > 0 &&
          priorDropCount > 0 &&
          adSet.sourceType === "page_group"
        ) {
          hasAttemptedRecreateFallback = true;
          const group = pageGroups.find((g) => g.id === adSet.sourceId);
          if (group && group.pageIds.length > 0 && group.engagementTypes.length > 0) {
            console.log(
              `[launch-campaign] ${logPrefix} — "${adSet.name}" — availability-API salvage exhausted` +
                ` (${priorDropCount} audience(s) already dropped via preflight/prior passes,` +
                ` ${requestedCaIds.length} "availability-clean" survivor(s) still refused by Meta` +
                ` at create time) — recreating engagement audiences for page group` +
                ` "${group.name}" from scratch`,
            );
            const recreated = await deps.recreateEngagementAudiencesForGroup(group);
            console.log(
              `[launch-campaign] ${logPrefix} — "${adSet.name}" — recreated ${recreated.ids.length}/` +
                `${recreated.ids.length + recreated.failed.length} engagement audience(s) for` +
                ` "${group.name}"` +
                (recreated.failed.length > 0
                  ? ` (${recreated.failed.length} failed: ` +
                    recreated.failed.map((f) => `${f.name}: ${f.error}`).join("; ") +
                    ")"
                  : ""),
            );
            if (recreated.ids.length > 0) {
              // Bookkeeping — replace stale (pageId, type) statuses with the
              // fresh ones so a future relaunch's "reuse existing" branch
              // picks these up instead of the ids Meta just refused; reset
              // the group's merged id list to the fresh set only ("from
              // scratch" means a full reset, not a union with refused ids).
              const now = new Date().toISOString();
              const recreatedKeys = new Set(recreated.created.map((c) => `${c.pageId}:${c.type}`));
              group.engagementAudienceStatuses = (group.engagementAudienceStatuses ?? []).filter(
                (s) => !recreatedKeys.has(`${s.pageId}:${s.type}`),
              );
              for (const c of recreated.created) {
                group.engagementAudienceStatuses.push({
                  id: c.id,
                  type: c.type,
                  pageId: c.pageId,
                  pageName: c.pageName,
                  createdAt: now,
                  readyForLookalike: false,
                  populating: false,
                });
              }
              const byType: Partial<Record<EngagementType, string>> = { ...(group.engagementAudiencesByType ?? {}) };
              for (const c of recreated.created) byType[c.type] = c.id;
              group.engagementAudiencesByType = byType;
              group.engagementAudienceIds = recreated.ids.slice();

              const finalPayload = {
                ...currentPayload,
                targeting: { ...currentPayload.targeting, custom_audiences: recreated.ids.map((id) => ({ id })) },
              };
              try {
                const finalRes = await deps.createMetaAdSet(adAccountId, finalPayload, launchToken);
                const dur = Date.now() - asStart;
                console.log(
                  `[launch-campaign] ${logPrefix} ✓  "${adSet.name}" (recreated audiences retry) → ` +
                    `${finalRes.id} (${dur}ms)`,
                );
                return {
                  metaAdSetId: finalRes.id,
                  durationMs: dur,
                  note:
                    `Recreated ${recreated.ids.length} engagement audience(s) after Meta refused` +
                    ` all availability-clean custom audiences (subcode 1359207 naming no` +
                    ` offending ids, after ${priorDropCount} audience(s) already dropped via` +
                    ` preflight/prior salvage passes).`,
                };
              } catch (finalErr) {
                console.error(
                  `[launch-campaign] ${logPrefix} ✗  "${adSet.name}" (recreated audiences retry):`,
                  deps.formatError(finalErr),
                );
                throw finalErr;
              }
            }
            console.warn(
              `[launch-campaign] ${logPrefix} ⚠  "${adSet.name}" — recreate-from-scratch fallback` +
                ` produced zero usable audiences for "${group.name}" — falling through to the` +
                ` original unrecoverable error`,
            );
          }
        }

        throw new Error(
          `${messageOf(currentErr)} — ${recovery.unrecoverable}` +
            (allDroppedIds.length > 0
              ? ` (after ${pass - 1} prior CA-salvage pass(es) already dropped ${allDroppedIds.length}` +
                ` audience(s): ${allDroppedIds.join(", ")})`
              : ""),
        );
      }

      for (const id of recovery.dropIds) {
        if (!allDroppedIds.includes(id)) allDroppedIds.push(id);
        allDroppedNames[id] = recoveryNames[id] ?? audienceNameById.get(id) ?? id;
      }

      console.log(
        `[launch-campaign] ${logPrefix} — "${adSet.name}" — CA salvage pass ${pass}/${MAX_CA_SALVAGE_PASSES},` +
          ` dropping ${recovery.dropIds.length} audience(s): ${recovery.dropIds.join(", ") || "none"}`,
      );

      const retryPayload = {
        ...currentPayload,
        targeting: { ...currentPayload.targeting, custom_audiences: recovery.keepIds.map((id) => ({ id })) },
      };

      try {
        const retryRes = await deps.createMetaAdSet(adAccountId, retryPayload, launchToken);
        const dur = Date.now() - asStart;
        console.log(
          `[launch-campaign] ${logPrefix} ✓  ad set (CA-salvage retry, pass ${pass}/${MAX_CA_SALVAGE_PASSES}):` +
            ` ${adSet.name} → ${retryRes.id} (${dur}ms)`,
        );
        return {
          metaAdSetId: retryRes.id,
          durationMs: dur,
          note:
            `Launched without ${allDroppedIds.length} unavailable audience` +
            `${allDroppedIds.length === 1 ? "" : "s"} across ${pass} salvage pass` +
            `${pass === 1 ? "" : "es"} (` +
            allDroppedIds.map((id) => (allDroppedNames[id] ? `${allDroppedNames[id]} (${id})` : id)).join(", ") +
            `).`,
        };
      } catch (retryErr) {
        const isAnotherBatch = isDeletedCustomAudienceError(retryErr);
        if (isAnotherBatch && pass < MAX_CA_SALVAGE_PASSES) {
          console.log(
            `[launch-campaign] ${logPrefix} ✗  "${adSet.name}" — CA salvage pass ${pass}/${MAX_CA_SALVAGE_PASSES}` +
              ` retry STILL rejected (subcode 1359207) — another batch of stale audiences was` +
              ` revealed; looping to pass ${pass + 1}/${MAX_CA_SALVAGE_PASSES}`,
          );
          currentPayload = retryPayload;
          currentErr = retryErr;
          continue;
        }
        if (isAnotherBatch) {
          throw new Error(
            `${messageOf(retryErr)} — hit the ${MAX_CA_SALVAGE_PASSES}-pass CA-salvage cap after` +
              ` dropping ${allDroppedIds.length} audience(s) total: ${allDroppedIds.join(", ")}.` +
              ` Meta is still revealing more unavailable audiences than this launch will loop` +
              ` through automatically — remove and re-add this ad set's audiences manually.`,
          );
        }
        console.error(
          `[launch-campaign] ${logPrefix} ✗  "${adSet.name}" (CA-salvage retry, pass ${pass}/${MAX_CA_SALVAGE_PASSES}):`,
          deps.formatError(retryErr),
        );
        throw retryErr;
      }
    }
    // Unreachable — every loop iteration above returns or throws.
    throw currentErr;
  }

  // ── Tier 2: subcode 1870196 — invalid targeting_automation VALUE ─────────
  if (isInvalidTargetingAutomationError(initialError)) {
    try {
      // task #124 — REPLACE targeting_automation with an explicit
      // { advantage_audience: 0 }, never delete it: Meta's Marketing API
      // v23.0+ requires the field present on EVERY ad-set-create call, so
      // omitting it just trades this rejection for subcode 1870227 (see
      // Tier 3 below) on the SAME retry — which this same catch used to
      // swallow before that sibling handler ever got a chance to run.
      // `advantage_audience: 0` (not 1) is the only value consistent with
      // the strict top-level age_min/age_max this retry commits to — Meta
      // rejects `advantage_audience: 1` paired with an age_max under 65.
      const retryPayload = {
        ...initialPayload,
        targeting: {
          ...initialPayload.targeting,
          age_min: adSet.ageMin,
          age_max: adSet.ageMax,
          targeting_automation: { advantage_audience: 0 as const },
        },
      };
      console.log(
        `[launch-campaign] ${logPrefix} ✗  "${adSet.name}" — Meta subcode 1870196 (invalid targeting` +
          ` automation) — retrying without Advantage+ Audience (advantage_audience explicitly 0)`,
      );
      const retryRes = await deps.createMetaAdSet(adAccountId, retryPayload, launchToken);
      const dur = Date.now() - asStart;
      console.log(
        `[launch-campaign] ${logPrefix} ✓  ad set (Advantage+ stripped retry): ${adSet.name} → ${retryRes.id} (${dur}ms)`,
      );
      return {
        metaAdSetId: retryRes.id,
        durationMs: dur,
        note:
          `Launched without Advantage+ Audience — Meta rejected the automated targeting type for ` +
          `this campaign's objective; targeted ages ${adSet.ageMin}–${adSet.ageMax} manually instead, ` +
          `with advantage_audience explicitly set to 0 (required by Meta API v23.0+ on every ad-set-create call).`,
        ageModeOverride: "strict",
      };
    } catch (recoveryErr) {
      // Log a failed RETRY distinctly from a failed FIRST attempt — see
      // Tier 3's identical comment for why this matters.
      console.error(
        `[launch-campaign] ${logPrefix} ✗  "${adSet.name}" (Advantage+-stripped retry):`,
        deps.formatError(recoveryErr),
      );
      throw recoveryErr;
    }
  }

  // ── Tier 3: subcode 1870227 — missing advantage_audience flag ────────────
  if (isMissingAdvantageAudienceFlagError(initialError)) {
    try {
      const advantageAudience = adSet.advantagePlus ? 1 : 0;
      const retryPayload = {
        ...initialPayload,
        targeting: {
          ...initialPayload.targeting,
          targeting_automation: { advantage_audience: advantageAudience as 0 | 1 },
        },
      };
      console.log(
        `[launch-campaign] ${logPrefix} ✗  "${adSet.name}" — Meta subcode 1870227 (missing` +
          ` advantage_audience flag) — retrying with advantage_audience=${advantageAudience} explicit`,
      );
      const retryRes = await deps.createMetaAdSet(adAccountId, retryPayload, launchToken);
      const dur = Date.now() - asStart;
      console.log(
        `[launch-campaign] ${logPrefix} ✓  ad set (advantage_audience retry): ${adSet.name} → ${retryRes.id} (${dur}ms)`,
      );
      return {
        metaAdSetId: retryRes.id,
        durationMs: dur,
        note: `Set advantage_audience=${advantageAudience} explicitly per Meta requirement.`,
      };
    } catch (recoveryErr) {
      // Previously this branch rethrew silently, making "classifier never
      // matched 1870227" indistinguishable in logs from "it matched,
      // retried, and the retry ALSO failed" — see task #123 FIX 3.
      console.error(
        `[launch-campaign] ${logPrefix} ✗  "${adSet.name}" (advantage_audience retry):`,
        deps.formatError(recoveryErr),
      );
      throw recoveryErr;
    }
  }

  // ── Tier 4: fallthrough diagnostic ────────────────────────────────────────
  // Nothing above recognised this error (this also covers deprecated-
  // interest errors — subcode 1870247 — which are deliberately not
  // classified in this module; see the "Deliberately NOT covered" doc
  // above). Log its code/subcode/message before rethrowing UNCHANGED, so
  // a caller's own interest-dep check still sees the original error, and a
  // genuinely unrecognised refusal is visible directly in prod logs.
  if (isMetaErrorLike(initialError)) {
    console.warn(
      `[launch-campaign] ${logPrefix} ⚠  "${adSet.name}" — unrecognised Meta error (no salvage/retry` +
        ` matched): code=${initialError.code ?? "n/a"} subcode=${initialError.subcode ?? "n/a"} message=${initialError.message}`,
    );
  }

  throw initialError;
}
