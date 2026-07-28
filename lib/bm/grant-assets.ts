import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getMetaUserId,
  resolveBusinessScopedUserId,
} from "@/lib/meta/business-manager";
import {
  grantUserAssetPermission,
  readAssetAssignedUsers,
} from "@/lib/meta/business-manager-assets";
import {
  getBusinessManagerToken,
  markBusinessManagerTokenExpired,
} from "@/lib/db/business-managers";
import {
  getMissingAccessAssetIds,
  logAssetAccessEvent,
  setAssetAccessFlag,
} from "@/lib/db/bm-assets";
import {
  describeAssetKind,
  grantSatisfied,
  tasksForRole,
  type BMAssetKind,
} from "@/lib/bm/asset-kinds";
import { isTokenExpiredMetaError } from "@/lib/bm/sync";
import { DEFAULT_GRANT_ROLE, type BusinessManager, type GrantRunOutcome } from "@/lib/bm/types";
import { isMetaAdAccountRateLimitError } from "@/lib/audiences/meta-rate-limit";
import { estimateRetryAfterMinutes, type AppUsageSnapshot } from "@/lib/meta/app-usage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/** Rate-limit guard — identical budget to the page grant path (lib/bm/grant.ts). */
const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 2_000;
const GRANT_REQUEST_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** See lib/bm/grant.ts — duck-typed so this stays independent of MetaApiError. */
function extractAppUsage(err: unknown): AppUsageSnapshot | null {
  if (!err || typeof err !== "object") return null;
  const rawErrorData = (err as { rawErrorData?: unknown }).rawErrorData;
  if (!rawErrorData || typeof rawErrorData !== "object") return null;
  const usage = (rawErrorData as Record<string, unknown>).__appUsage;
  return usage ? (usage as AppUsageSnapshot) : null;
}

export interface AssetGrantResult extends GrantRunOutcome {
  businessId: string;
  kind: BMAssetKind;
  failures: { assetId: string; error: string }[];
}

/**
 * Grant the operator ADVERTISER access on assets of one kind within a BM.
 *
 * Mirrors `grantPagesForBusinessManager` deliberately — same 50-per-batch
 * budget, same 500ms inter-request throttle, and the same HALT-on-rate-limit
 * behaviour (continuing through a rejected quota window just deepens it; see
 * the 2026-07-09 Columbo Group incident, where one rate limit produced 200+
 * sync_error rows).
 *
 * Verification is a SUPERSET check, not equality: Meta expands grants. A
 * requested `ADVERTISE` on an IG asset reads back as five tasks. `user_tasks`
 * records what Meta actually stored, so the UI can explain the real access.
 *
 * @param assetIds When omitted, grants on ALL currently-missing assets of this kind.
 */
export async function grantAssetsForBusinessManager(
  supabase: AnySupabaseClient,
  bm: BusinessManager,
  kind: BMAssetKind,
  opts: { assetIds?: string[]; actorUserId: string | null; verify?: boolean },
): Promise<AssetGrantResult> {
  const bizId = bm.business_id;
  const result: AssetGrantResult = {
    businessId: bizId,
    kind,
    attempted: 0,
    granted: 0,
    failed: 0,
    batches: 0,
    failures: [],
  };

  let assetIds = opts.assetIds ?? null;
  if (!assetIds) {
    assetIds = await getMissingAccessAssetIds(supabase, kind, bizId);
  }
  if (assetIds.length === 0) return result;
  result.totalTargeted = assetIds.length;

  const token = await getBusinessManagerToken(supabase, bm.id);
  if (!token) {
    result.tokenExpired = true;
    result.failures.push({ assetId: "-", error: "no_token_stored" });
    return result;
  }

  // targetUserId is the BUSINESS-SCOPED id the assigned_users edge requires;
  // fbUserId is the Facebook-level id, kept for audit cross-reference only.
  let fbUserId: string;
  let targetUserId: string;
  try {
    fbUserId = await getMetaUserId(token);
    targetUserId = await resolveBusinessScopedUserId(bizId, token);
  } catch (err) {
    if (isTokenExpiredMetaError(err)) {
      await markBusinessManagerTokenExpired(supabase, bizId, "token_expired");
      result.tokenExpired = true;
    }
    result.failures.push({
      assetId: "-",
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  const requestedTasks = tasksForRole(kind, DEFAULT_GRANT_ROLE);
  const label = describeAssetKind(kind).label;

  for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
    const batch = assetIds.slice(i, i + BATCH_SIZE);
    result.batches += 1;

    for (let b = 0; b < batch.length; b += 1) {
      const assetId = batch[b];
      result.attempted += 1;
      try {
        await grantUserAssetPermission(
          kind,
          bizId,
          assetId,
          targetUserId,
          DEFAULT_GRANT_ROLE,
          token,
        );

        // Read back what Meta actually stored. `{success:true}` is necessary
        // but not sufficient evidence — it confirms the call was accepted, not
        // that the operator ended up with the tasks. Opt-in because it doubles
        // the request count on a bulk run.
        let storedTasks = requestedTasks;
        if (opts.verify) {
          const assignments = await readAssetAssignedUsers(assetId, bizId, token);
          storedTasks = assignments.find((a) => a.id === targetUserId)?.tasks ?? [];
          if (!grantSatisfied(requestedTasks, storedTasks)) {
            result.failed += 1;
            result.failures.push({
              assetId,
              error: `${label} grant reported success but read back tasks [${storedTasks.join(",")}]`,
            });
            await logAssetAccessEvent(supabase, {
              businessId: bizId,
              kind,
              assetId,
              userId: opts.actorUserId,
              action: "sync_error",
              detail: {
                phase: "grant_verify",
                requested_tasks: requestedTasks,
                stored_tasks: storedTasks,
              },
            });
            continue;
          }
        }

        result.granted += 1;
        await setAssetAccessFlag(supabase, kind, bizId, assetId, true, storedTasks);
        await logAssetAccessEvent(supabase, {
          businessId: bizId,
          kind,
          assetId,
          userId: opts.actorUserId,
          action: "granted",
          detail: {
            role: DEFAULT_GRANT_ROLE,
            requested_tasks: requestedTasks,
            stored_tasks: storedTasks,
            verified: Boolean(opts.verify),
            target_user_id: targetUserId,
            fb_user_id: fbUserId,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Meta's app/user/ad-account quota (#4/#17/#80004) — HALT the whole run.
        if (isMetaAdAccountRateLimitError(err)) {
          const appUsage = extractAppUsage(err);
          const retryAfterMinutes = estimateRetryAfterMinutes(appUsage);
          result.rateLimited = true;
          result.retryAfterMinutes = retryAfterMinutes;
          console.warn(
            `[bm grant] biz=${bizId} kind=${kind} HALT on Meta rate limit at asset=${assetId} ` +
              `(${result.granted}/${result.totalTargeted} granted so far): ${msg}`,
          );
          await logAssetAccessEvent(supabase, {
            businessId: bizId,
            kind,
            assetId,
            userId: opts.actorUserId,
            action: "rate_limited",
            detail: {
              phase: "grant",
              message: msg,
              granted_so_far: result.granted,
              total_targeted: result.totalTargeted,
              retry_after_minutes: retryAfterMinutes,
              app_usage: appUsage,
            },
          });
          return result;
        }

        result.failed += 1;
        result.failures.push({ assetId, error: msg });
        await logAssetAccessEvent(supabase, {
          businessId: bizId,
          kind,
          assetId,
          userId: opts.actorUserId,
          action: "sync_error",
          detail: { phase: "grant", message: msg },
        });
        if (isTokenExpiredMetaError(err)) {
          await markBusinessManagerTokenExpired(supabase, bizId, msg);
          result.tokenExpired = true;
          return result;
        }
      }

      const isLastOverall = i + b === assetIds.length - 1;
      if (!isLastOverall) await sleep(GRANT_REQUEST_DELAY_MS);
    }

    if (i + BATCH_SIZE < assetIds.length) await sleep(BATCH_SLEEP_MS);
  }

  return result;
}
