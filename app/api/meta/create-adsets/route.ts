import { createClient } from "@/lib/supabase/server";
import { createMetaAdSets, MetaApiError } from "@/lib/meta/client";
import {
  buildAdSetPayload,
  validateAdSetPayloads,
  type CreateAdSetsRequest,
} from "@/lib/meta/adset";

export async function POST(request: Request) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: Partial<CreateAdSetsRequest>;
  try {
    body = (await request.json()) as Partial<CreateAdSetsRequest>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    metaAdAccountId,
    metaCampaignId,
    optimisationGoal,
    objective,
    pixelId,
    budgetSchedule,
    audiences,
    adSetSuggestions,
  } = body as CreateAdSetsRequest;

  // ── 3. Basic presence check ───────────────────────────────────────────────
  if (!metaAdAccountId || !metaCampaignId || !optimisationGoal || !objective) {
    return Response.json(
      { error: "metaAdAccountId, metaCampaignId, optimisationGoal, and objective are required" },
      { status: 400 },
    );
  }

  // ── 4. Validate ad set suggestions ────────────────────────────────────────
  const { isValid, errors } = validateAdSetPayloads(adSetSuggestions ?? []);
  if (!isValid) {
    return Response.json({ error: "Validation failed", details: errors }, { status: 400 });
  }

  // ── 5. Build Meta payloads ────────────────────────────────────────────────
  const payloads = adSetSuggestions.map((adSet) =>
    buildAdSetPayload(
      adSet,
      metaCampaignId,
      audiences,
      budgetSchedule,
      optimisationGoal,
      objective,
      pixelId,
    ),
  );

  // ── 6. Call Meta (per-adset, non-atomic batch) ────────────────────────────
  try {
    const result = await createMetaAdSets(metaAdAccountId, payloads);

    const status = result.created.length > 0 ? 201 : 502;
    return Response.json(result, { status });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/create-adsets] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
