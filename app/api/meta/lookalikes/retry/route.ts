/**
 * POST /api/meta/lookalikes/retry
 *
 * Retry lookalike creation for page groups that have existing engagement source
 * audiences which were previously deferred (code 441 — still populating).
 *
 * Skips Phase 1 (campaign) and Phase 1.5 (audience creation) entirely.
 * Only checks readiness on persisted audience IDs and creates lookalikes for
 * those that are now ready.
 *
 * Returns: { created, deferred, failed, updatedStatuses }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkAudienceReadiness,
  createLookalikeAudience,
  parseLookalikeRange,
  rankSeedsByPreference,
  MetaApiError,
} from "@/lib/meta/client";
import type { TypedSeed } from "@/lib/meta/client";
import type { CampaignDraft, EngagementAudienceStatus } from "@/lib/types";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let draft: CampaignDraft;
  try {
    const body = (await req.json()) as { draft?: CampaignDraft };
    if (!body?.draft) throw new Error("Missing draft");
    draft = body.draft;
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid request body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  const adAccountId = draft.settings.metaAdAccountId || draft.settings.adAccountId;
  if (!adAccountId) {
    return NextResponse.json({ error: "Ad account ID is required" }, { status: 400 });
  }

  // Load user Facebook token
  let userFbToken: string | null = null;
  try {
    const { data } = await supabase
      .from("user_facebook_tokens")
      .select("provider_token")
      .eq("user_id", user.id)
      .maybeSingle();
    userFbToken = data?.provider_token ?? null;
  } catch { /* non-fatal */ }

  // Determine lookalike country from ad set suggestions
  let lookalikeCountry = "GB";
  for (const adSet of draft.adSetSuggestions) {
    if (adSet.geoLocations?.countries?.[0]) {
      lookalikeCountry = adSet.geoLocations.countries[0];
      break;
    }
  }

  const created: Array<{ name: string; id: string; range: string; seedAudienceId: string }> = [];
  const deferred: Array<{ name: string; seedAudienceId: string; code: number; description: string }> = [];
  const failed: Array<{ name: string; seedAudienceId: string; error: string }> = [];
  const updatedStatuses: Array<{ groupId: string; statuses: EngagementAudienceStatus[] }> = [];

  const RETRY_TIMEOUT_MS = 60_000;
  const deadline = Date.now() + RETRY_TIMEOUT_MS;

  for (const group of draft.audiences.pageGroups) {
    if (!group.lookalike) continue;
    const statuses = group.engagementAudienceStatuses ?? [];
    if (statuses.length === 0) continue;

    const ranges = group.lookalikeRanges?.length ? group.lookalikeRanges : ["0-1%"];
    const groupName = group.name || "Page Group";

    // Build typed seeds from persisted statuses (all, not just deferred — they
    // may have become ready since the last launch)
    const seeds: TypedSeed[] = statuses
      .filter((s) => s.id)
      .map((s) => ({ id: s.id, type: s.type as import("@/lib/meta/client").EngagementAudienceType, fromCache: true }));
    const rankedSeeds = rankSeedsByPreference(seeds);

    for (const range of ranges) {
      if (Date.now() >= deadline) break;

      const { startingRatio, endingRatio } = parseLookalikeRange(range);
      const pctLabel = `${Math.round(endingRatio * 100)}%`;
      const lalName = `${groupName} — ${pctLabel} Lookalike`;
      let succeeded = false;

      for (const seed of rankedSeeds) {
        if (Date.now() >= deadline || succeeded) break;

        // Check readiness
        const readiness = await checkAudienceReadiness(seed.id, userFbToken ?? undefined);
        const now = new Date().toISOString();
        const st = statuses.find((s) => s.id === seed.id);
        if (st && readiness) {
          st.lastCheckedAt = now;
          st.lastReadinessCode = readiness.code;
          st.lastReadinessDescription = readiness.description;
          st.readyForLookalike = readiness.ready;
          st.populating = readiness.populating;
        }

        console.log(
          `[lookalikes/retry] ${groupName} "${range}" seed=${seed.id} (${seed.type})` +
          ` ready=${readiness?.ready ?? "?"} populating=${readiness?.populating ?? "?"} code=${readiness?.code ?? "?"}`,
        );

        if (!readiness?.ready) {
          deferred.push({
            name: lalName,
            seedAudienceId: seed.id,
            code: readiness?.code ?? 0,
            description: readiness?.description ?? "unknown",
          });
          continue;
        }

        // Audience is ready — create the lookalike
        try {
          const result = await createLookalikeAudience(adAccountId, {
            name: lalName,
            originAudienceId: seed.id,
            startingRatio,
            endingRatio,
            country: lookalikeCountry,
          });
          created.push({ name: lalName, id: result.id, range, seedAudienceId: seed.id });
          if (st) st.lookalikeId = result.id;
          succeeded = true;
          console.log(`[lookalikes/retry] ✓ ${lalName} → ${result.id}`);
        } catch (err) {
          const message = err instanceof MetaApiError ? err.message : String(err);
          failed.push({ name: lalName, seedAudienceId: seed.id, error: message });
          console.error(`[lookalikes/retry] ✗ ${lalName}:`, message);
        }
      }
    }

    if (statuses.length > 0) {
      updatedStatuses.push({ groupId: group.id, statuses });
    }
  }

  console.log(
    `[lookalikes/retry] done — created=${created.length} deferred=${deferred.length} failed=${failed.length}`,
  );

  return NextResponse.json({ created, deferred, failed, updatedStatuses });
}
