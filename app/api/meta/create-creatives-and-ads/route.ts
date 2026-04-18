import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createMetaCreative,
  createMetaAd,
  fetchAdAccountIgActors,
  MetaApiError,
} from "@/lib/meta/client";
import {
  buildCreativePayload,
  buildAdPayload,
  invertAssignments,
  validateCreativePayload,
  sanitizeCreativeForStrictMode,
  type CreateCreativesAndAdsRequest,
  type CreateCreativesAndAdsResult,
  type CreativeCreationResult,
  type CreativeFailureResult,
} from "@/lib/meta/creative";
import type { AdCreativeDraft, AdSetSuggestion } from "@/lib/types";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: CreateCreativesAndAdsRequest;
  try {
    body = (await req.json()) as CreateCreativesAndAdsRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { metaAdAccountId, creatives, assignments, adSetSuggestions } = body;
  // Creative Integrity Mode defaults to ON when the caller omits the flag.
  const strictMode: boolean = body.creativeIntegrityMode !== false;
  console.log(
    `[create-creatives-and-ads] creativeIntegrityMode=${strictMode ? "ON" : "OFF"}`,
  );

  if (!metaAdAccountId) {
    return NextResponse.json(
      { error: "metaAdAccountId is required" },
      { status: 400 },
    );
  }

  if (!Array.isArray(creatives) || creatives.length === 0) {
    return NextResponse.json(
      { error: "creatives array is required and must not be empty" },
      { status: 400 },
    );
  }

  // ── Validate every creative ───────────────────────────────────────────────
  const validationErrors: string[] = [];
  for (const creative of creatives) {
    const { errors } = validateCreativePayload(creative);
    validationErrors.push(...errors);
  }

  if (validationErrors.length > 0) {
    return NextResponse.json({ errors: validationErrors }, { status: 400 });
  }

  // ── Build lookup helpers ──────────────────────────────────────────────────
  // internalCreativeId → [ internalAdSetId, ... ]
  const creativeToInternalAdSetIds = invertAssignments(assignments ?? {});

  // internalAdSetId → AdSetSuggestion (for metaAdSetId + name lookups)
  const adSetByInternalId = new Map<string, AdSetSuggestion>(
    (adSetSuggestions ?? []).map((s) => [s.id, s]),
  );

  // ── Resolve Instagram actor IDs from the ad account ───────────────────────
  // Same logic as Phase 0e in launch-campaign: verify instagramActorId against
  // GET /{adAccountId}/instagram_accounts before building creative payloads.
  const igExistingPostCreatives = (creatives as AdCreativeDraft[]).filter(
    (c) => c.sourceType === "existing_post" && c.existingPost?.source === "instagram",
  );

  let patchedCreatives: AdCreativeDraft[] = (creatives as AdCreativeDraft[]).map((c) => ({ ...c }));

  if (igExistingPostCreatives.length > 0) {
    console.log(
      `[create-creatives-and-ads] Resolving IG actor IDs for ${igExistingPostCreatives.length}` +
        ` existing-post creative(s) from ${metaAdAccountId}/instagram_accounts…`,
    );

    // Fetch user's Facebook token for the actor lookup (same token used to
    // call the Ads API).  Falls back to system token inside fetchAdAccountIgActors.
    let userFbToken: string | null = null;
    try {
      const { data: fbRow } = await supabase
        .from("user_facebook_tokens")
        .select("provider_token")
        .eq("user_id", user.id)
        .maybeSingle();
      userFbToken = fbRow?.provider_token ?? null;
    } catch {
      // non-fatal
    }

    const adAccountActors = await fetchAdAccountIgActors(
      metaAdAccountId,
      userFbToken ?? undefined,
    );
    const actorById = new Map(adAccountActors.map((a) => [a.id, a]));

    patchedCreatives = patchedCreatives.map((creative) => {
      if (
        creative.sourceType !== "existing_post" ||
        creative.existingPost?.source !== "instagram"
      ) {
        return creative;
      }

      const contentId =
        creative.identity.instagramActorId ||
        creative.identity.instagramAccountId ||
        creative.existingPost?.instagramAccountId;

      console.log(
        `[create-creatives-and-ads] IG actor check for "${creative.name}":` +
          ` pageId=${creative.identity.pageId}` +
          ` instagramActorId=${creative.identity.instagramActorId ?? "(unset)"}` +
          ` instagramAccountId=${creative.identity.instagramAccountId ?? "(unset)"}` +
          ` contentId=${contentId ?? "(none)"}` +
          ` adAccountActors=${adAccountActors.length}`,
      );

      if (contentId && actorById.has(contentId)) {
        const actor = actorById.get(contentId)!;
        console.log(
          `[create-creatives-and-ads] IG actor verified for "${creative.name}":` +
            ` id=${actor.id}${actor.username ? ` (@${actor.username})` : ""}`,
        );
        return {
          ...creative,
          identity: { ...creative.identity, instagramActorId: actor.id },
        };
      }

      if (adAccountActors.length > 0) {
        console.warn(
          `[create-creatives-and-ads] IG actor NOT found for "${creative.name}":` +
            ` contentId=${contentId ?? "(none)"} not in [${adAccountActors.map((a) => a.id).join(", ")}]`,
        );
      }
      return creative;
    });
  }

  // ── Create creatives + ads ────────────────────────────────────────────────
  const created: CreativeCreationResult[] = [];
  const failed: CreativeFailureResult[] = [];

  for (const creative of patchedCreatives) {
    // 1. Build + validate Meta creative payload
    let payload;
    try {
      payload = buildCreativePayload(creative);
      if (strictMode) {
        const report = sanitizeCreativeForStrictMode(payload);
        console.log(
          `[create-creatives-and-ads] strict mode applied for "${creative.name}":` +
            ` strippedTopLevel=${report.strippedTopLevel.join(",") || "(none)"}` +
            ` strippedLinkData=${report.strippedLinkData.join(",") || "(none)"}` +
            ` optedOutFeatures=${report.optedOutFeatures.length}`,
        );
      } else {
        console.warn(
          `[create-creatives-and-ads] strict mode DISABLED for "${creative.name}"`,
        );
      }
    } catch (err) {
      failed.push({
        name: creative.name,
        internalId: creative.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // 2. Create the ad creative
    console.log(
      `[create-creatives-and-ads] identity for "${creative.name}":` +
        ` adAccountId=${metaAdAccountId}` +
        ` pageId=${creative.identity?.pageId ?? "(none)"}` +
        ` instagramAccountId=${creative.identity?.instagramAccountId ?? "(unset)"}` +
        ` instagramActorId=${creative.identity?.instagramActorId ?? "(unset)"}` +
        ` sourceType=${creative.sourceType}` +
        ` existingPost.source=${creative.existingPost?.source ?? "n/a"}`,
    );
    let metaCreativeId: string;
    try {
      const res = await createMetaCreative(metaAdAccountId, payload);
      metaCreativeId = res.id;
      console.log(
        `[create-creatives-and-ads] creative created: name="${creative.name}"` +
          ` internalId=${creative.id} metaCreativeId=${metaCreativeId}` +
          ` strictMode=${strictMode}`,
      );
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : `Unexpected error: ${String(err)}`;
      failed.push({
        name: creative.name,
        internalId: creative.id,
        error: message,
      });
      continue;
    }

    // 3. Create one Meta ad per assigned ad set
    const assignedInternalAdSetIds = creativeToInternalAdSetIds[creative.id] ?? [];
    const adsCreated: CreativeCreationResult["ads"] = [];
    const adsFailed: CreativeCreationResult["adsFailed"] = [];

    for (const internalAdSetId of assignedInternalAdSetIds) {
      const adSet = adSetByInternalId.get(internalAdSetId);

      if (!adSet?.metaAdSetId) {
        // Ad set was not created in Meta (Phase 4 failed for it) — skip
        adsFailed.push({
          adSetName: adSet?.name ?? internalAdSetId,
          error: "Ad set was not created in Meta (no metaAdSetId)",
        });
        continue;
      }

      const adPayload = buildAdPayload(
        `${creative.name} — ${adSet.name}`,
        metaCreativeId,
        adSet.metaAdSetId,
      );

      try {
        const adRes = await createMetaAd(metaAdAccountId, adPayload);
        adsCreated.push({ adSetName: adSet.name, metaAdId: adRes.id });
        console.log(
          `[create-creatives-and-ads] ad created: adSetName="${adSet.name}"` +
            ` metaAdId=${adRes.id} metaCreativeId=${metaCreativeId}` +
            ` strictMode=${strictMode}`,
        );
      } catch (err) {
        const message =
          err instanceof MetaApiError
            ? err.message
            : `Unexpected error: ${String(err)}`;
        adsFailed.push({ adSetName: adSet.name, error: message });
      }
    }

    created.push({
      name: creative.name,
      internalId: creative.id,
      metaCreativeId,
      ads: adsCreated,
      adsFailed,
    });
  }

  const result: CreateCreativesAndAdsResult = { created, failed };
  return NextResponse.json(result, { status: 201 });
}
