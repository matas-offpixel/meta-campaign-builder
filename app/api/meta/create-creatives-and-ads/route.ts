import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createMetaCreative,
  createMetaAd,
  fetchAdAccountIgActors,
  MetaApiError,
} from "@/lib/meta/client";
import {
  resolvePageIdentity,
  resolvePageIgActor,
} from "@/lib/meta/page-token";
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

  // ── Resolve Instagram actor IDs from the Page (agency-safe) ─────────────
  // Use GET /{pageId}/instagram_accounts (Page-level) not GET /{adAccountId}/instagram_accounts
  // (BM-asset list). The Page-level endpoint works for agency workflows where the
  // client grants Page access and the IG account is linked but not a direct BM asset.
  const igExistingPostCreatives = (creatives as AdCreativeDraft[]).filter(
    (c) => c.sourceType === "existing_post" && c.existingPost?.source === "instagram",
  );

  // Fetch user FB token once — used for resolvePageIdentity + retry fallback.
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

  let patchedCreatives: AdCreativeDraft[] = (creatives as AdCreativeDraft[]).map((c) => ({ ...c }));

  if (igExistingPostCreatives.length > 0) {
    const uniquePageIds = [
      ...new Set(
        igExistingPostCreatives
          .map((c) => c.identity.pageId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const pageActorMap = new Map<string, string>();

    for (const pageId of uniquePageIds) {
      const pageIdentity = await resolvePageIdentity(pageId, userFbToken);
      if (pageIdentity.pageAccessToken && pageIdentity.ig.state === "linked") {
        const resolved = await resolvePageIgActor(
          pageId,
          pageIdentity.pageAccessToken,
          pageIdentity.ig.account.id,
        );
        if (resolved) {
          pageActorMap.set(pageId, resolved.actorId);
          console.log(
            `[create-creatives-and-ads] page ${pageId}: igActorId=${resolved.actorId} source=${resolved.source}`,
          );
        }
      } else if (pageIdentity.ig.state === "linked") {
        pageActorMap.set(pageId, pageIdentity.ig.account.id);
        console.warn(
          `[create-creatives-and-ads] page ${pageId}: no page token; using content id ${pageIdentity.ig.account.id} as fallback`,
        );
      }
    }

    patchedCreatives = patchedCreatives.map((creative) => {
      if (
        creative.sourceType !== "existing_post" ||
        creative.existingPost?.source !== "instagram"
      ) {
        return creative;
      }
      const resolvedActorId = pageActorMap.get(creative.identity.pageId ?? "");
      if (resolvedActorId) {
        return {
          ...creative,
          identity: { ...creative.identity, instagramActorId: resolvedActorId },
        };
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
      // ── (#100) instagram_actor_id retry ───────────────────────────────────
      const isMetaErr = err instanceof MetaApiError;
      const isActorError =
        isMetaErr &&
        err.code === 100 &&
        (err.message.toLowerCase().includes("instagram_actor_id") ||
          err.message.toLowerCase().includes("instagram account id"));

      if (isActorError) {
        console.warn(
          `[create-creatives-and-ads] (#100) actor error for "${creative.name}" — attempting recovery`,
        );

        // Parse valid ids from Meta error message, then fall back to ad-account list.
        const haystack = `${err.message} ${err.userMsg ?? ""}`;
        const match =
          haystack.match(/Valid actor IDs?:\s*\[([^\]]+)\]/i) ??
          haystack.match(/valid (?:Instagram )?account (?:id|IDs?):\s*\[([^\]]+)\]/i);
        let recoveryIds: string[] = match
          ? match[1].split(",").map((s) => s.trim()).filter(Boolean)
          : [];

        if (recoveryIds.length === 0) {
          const actors = await fetchAdAccountIgActors(metaAdAccountId, userFbToken ?? undefined);
          recoveryIds = actors.map((a) => a.id);
          console.log(
            `[create-creatives-and-ads] recovery: ad account actors [${recoveryIds.join(", ")}]`,
          );
        }

        if (recoveryIds.length > 0) {
          try {
            const retryCrv = {
              ...creative,
              identity: { ...creative.identity, instagramActorId: recoveryIds[0] },
            };
            const retryPayload = buildCreativePayload(retryCrv);
            if (strictMode) sanitizeCreativeForStrictMode(retryPayload);
            const retryRes = await createMetaCreative(metaAdAccountId, retryPayload);
            metaCreativeId = retryRes.id;
            console.log(
              `[create-creatives-and-ads] retry ✓ "${creative.name}" actorId=${recoveryIds[0]} → ${metaCreativeId}`,
            );
          } catch (retryErr) {
            const retryMsg = retryErr instanceof MetaApiError ? retryErr.message : String(retryErr);
            failed.push({ name: creative.name, internalId: creative.id, error: retryMsg });
            continue;
          }
        } else {
          failed.push({ name: creative.name, internalId: creative.id, error: err.message });
          continue;
        }
      } else {
        const message = isMetaErr ? err.message : `Unexpected error: ${String(err)}`;
        failed.push({ name: creative.name, internalId: creative.id, error: message });
        continue;
      }
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
