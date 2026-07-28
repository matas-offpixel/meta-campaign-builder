import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  findAudienceSeedLocations,
  getBusinessManagerByBizId,
  getBusinessManagerToken,
  logAccessEvent,
  recordPageGrantRequest,
  setPageAccessFlag,
  type AudienceSeedLocation,
} from "@/lib/db/business-managers";
import { grantUserInstagramPermission } from "@/lib/meta/business-manager-assets";
import { grantUserPageTasks, resolveBusinessScopedUserId } from "@/lib/meta/business-manager";
import { PAGE_TASK_ADVERTISE, validatePageTasks } from "@/lib/bm/page-tasks";
import { DEFAULT_GRANT_ROLE } from "@/lib/bm/types";

/**
 * lib/audiences/seed-remediation.ts
 *
 * Fixes the cause of subcode 1713140 rather than working around it: grants the
 * operator ADVERTISE on the seed the audience was refused for.
 *
 * ── Why ADVERTISE, and why this works ───────────────────────────────────────
 * Verified live on 2026-07-28 (fixture
 * `__tests__/fixtures/event_source_permission_remediation.json`): a seed page the
 * operator held no role on failed with 2654/1713140; granting plain `ADVERTISE`
 * made the identical create succeed; the grant was then revoked to restore state.
 * So ADVERTISE is sufficient and FULL_CONTROL is not required — which matters,
 * because ADVERTISE is exactly what `/business-managers` already promises to
 * grant ("enough to run ads, no owner-level actions").
 *
 * ── Deliberate constraints ──────────────────────────────────────────────────
 *   - Uses the per-BM stored token ONLY. There is no META_ACCESS_TOKEN fallback,
 *     matching the BM tool's rule: asset-permission writes act as the operator's
 *     own identity or not at all.
 *   - Grants only ADVERTISE, and routes it through `validatePageTasks` so this
 *     path cannot become a way to request tasks the tool refuses to grant.
 *   - Never throws. Remediation is an OPPORTUNISTIC step inside a failing write:
 *     if it cannot run (no connected BM, expired token, Meta refusal) the caller
 *     still has the drop-and-retry fallback, and a thrown error here would
 *     replace Meta's real diagnosis with an unrelated one.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export interface SeedRemediationOutcome {
  /** Seeds now granted ADVERTISE, in the order they were requested. */
  remediated: string[];
  /** Seeds that could not be remediated, with the reason. */
  skipped: { sourceId: string; reason: string }[];
}

export interface RemediateSeedsDeps {
  /** Injectable for tests; defaults to the live Graph grant for pages. */
  grantPage?: typeof grantUserPageTasks;
  /** Injectable for tests; defaults to the live Graph grant for IG assets. */
  grantIg?: typeof grantUserInstagramPermission;
  /** Injectable for tests; defaults to the live business-scoped user lookup. */
  resolveScopedUser?: typeof resolveBusinessScopedUserId;
}

/**
 * Try to grant the operator ADVERTISE on each named seed.
 *
 * @param sourceIds ids exactly as they appeared in the audience rule. For IG
 *   these are Instagram USER ids; the mapping to the business-asset id the grant
 *   edge needs happens in {@link findAudienceSeedLocations}.
 */
export async function remediateAudienceSeeds(
  supabase: AnySupabaseClient,
  sourceIds: string[],
  opts: { actorUserId: string | null; deps?: RemediateSeedsDeps } = { actorUserId: null },
): Promise<SeedRemediationOutcome> {
  const out: SeedRemediationOutcome = { remediated: [], skipped: [] };
  if (sourceIds.length === 0) return out;

  const grantPage = opts.deps?.grantPage ?? grantUserPageTasks;
  const grantIg = opts.deps?.grantIg ?? grantUserInstagramPermission;
  const resolveScoped = opts.deps?.resolveScopedUser ?? resolveBusinessScopedUserId;

  // Guard rail, not decoration: this is the check that would have caught PR
  // #727's own root cause, and it keeps this path from ever requesting a task
  // the tool has decided not to grant.
  const validation = validatePageTasks([PAGE_TASK_ADVERTISE]);
  if (!validation.ok) {
    for (const id of sourceIds) {
      out.skipped.push({ sourceId: id, reason: validation.error ?? "invalid task set" });
    }
    return out;
  }

  let locations: AudienceSeedLocation[];
  try {
    locations = await findAudienceSeedLocations(supabase, sourceIds);
  } catch (err) {
    const reason = `could not look up seed: ${err instanceof Error ? err.message : String(err)}`;
    for (const id of sourceIds) out.skipped.push({ sourceId: id, reason });
    return out;
  }

  // Cache per BM so several seeds in one business cost one token read and one
  // business-scoped-user lookup, not one each.
  const scopedUserByBiz = new Map<string, string | null>();
  const tokenByBiz = new Map<string, string | null>();

  for (const sourceId of sourceIds) {
    const candidates = locations.filter((l) => l.sourceId === sourceId);
    if (candidates.length === 0) {
      out.skipped.push({
        sourceId,
        reason:
          "not found in any connected Business Manager — connect the BM that owns " +
          "this source, or ask its admin for access",
      });
      continue;
    }

    let lastReason = "no connected Business Manager could grant access";
    let done = false;

    for (const loc of candidates) {
      const bm = await getBusinessManagerByBizId(supabase, loc.businessId);
      if (!bm) {
        lastReason = `Business Manager ${loc.businessId} is not connected`;
        continue;
      }
      if (bm.token_expired) {
        lastReason = `Business Manager ${bm.business_name ?? loc.businessId} needs reconnecting`;
        continue;
      }

      if (!tokenByBiz.has(loc.businessId)) {
        tokenByBiz.set(loc.businessId, await getBusinessManagerToken(supabase, bm.id));
      }
      const token = tokenByBiz.get(loc.businessId);
      if (!token) {
        lastReason = `no stored token for ${bm.business_name ?? loc.businessId}`;
        continue;
      }

      if (!scopedUserByBiz.has(loc.businessId)) {
        try {
          scopedUserByBiz.set(
            loc.businessId,
            await resolveScoped(loc.businessId, token),
          );
        } catch (err) {
          scopedUserByBiz.set(loc.businessId, null);
          lastReason = `could not resolve your business user in ${
            bm.business_name ?? loc.businessId
          }: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      const scopedUser = scopedUserByBiz.get(loc.businessId);
      if (!scopedUser) continue;

      try {
        if (loc.kind === "page") {
          await grantPage(loc.businessId, loc.grantAssetId, scopedUser, [PAGE_TASK_ADVERTISE], token);
          // Reflect it locally so the picker stops warning about this seed before
          // the next scan runs. `user_tasks` is deliberately NOT written here: it
          // records what META reports, and only a read-back may set it (Meta
          // expands grants — PR #726).
          await setPageAccessFlag(supabase, loc.businessId, loc.grantAssetId, true);
          await recordPageGrantRequest(supabase, loc.businessId, loc.grantAssetId, [
            PAGE_TASK_ADVERTISE,
          ]);
        } else {
          // ADVERTISER, not a raw task list: the IG grant builder maps role →
          // tasks per asset kind and validates against Meta's IG task enum
          // (PR #726). It resolves to ADVERTISE, which Meta then expands.
          await grantIg(loc.businessId, loc.grantAssetId, scopedUser, DEFAULT_GRANT_ROLE, token);
        }

        await logAccessEvent(supabase, {
          businessId: loc.businessId,
          pageId: loc.kind === "page" ? loc.grantAssetId : "-",
          userId: opts.actorUserId,
          action: "granted",
          detail: {
            phase: "audience_seed_remediation",
            subcode: 1713140,
            asset_kind: loc.kind,
            source_id: loc.sourceId,
            grant_asset_id: loc.grantAssetId,
            requested_tasks: [PAGE_TASK_ADVERTISE],
            target_user_id: scopedUser,
          },
        });

        out.remediated.push(sourceId);
        done = true;
        break;
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
      }
    }

    if (!done) out.skipped.push({ sourceId, reason: lastReason });
  }

  return out;
}
