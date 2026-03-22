import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createMetaCreative, createMetaAd, MetaApiError } from "@/lib/meta/client";
import {
  buildCreativePayload,
  buildAdPayload,
  invertAssignments,
  validateCreativePayload,
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

  // ── Create creatives + ads ────────────────────────────────────────────────
  const created: CreativeCreationResult[] = [];
  const failed: CreativeFailureResult[] = [];

  for (const creative of creatives as AdCreativeDraft[]) {
    // 1. Build + validate Meta creative payload
    let payload;
    try {
      payload = buildCreativePayload(creative);
    } catch (err) {
      failed.push({
        name: creative.name,
        internalId: creative.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // 2. Create the ad creative
    let metaCreativeId: string;
    try {
      const res = await createMetaCreative(metaAdAccountId, payload);
      metaCreativeId = res.id;
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
