import { createClient } from "@/lib/supabase/server";
import { createMetaCampaign, MetaApiError } from "@/lib/meta/client";
import {
  validateCampaignPayload,
  type CreateCampaignRequest,
  type CreateCampaignResult,
} from "@/lib/meta/campaign";

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
  let body: Partial<CreateCampaignRequest>;
  try {
    body = (await request.json()) as Partial<CreateCampaignRequest>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── 3. Validate ───────────────────────────────────────────────────────────
  const { isValid, errors } = validateCampaignPayload(body);
  if (!isValid) {
    return Response.json({ error: "Validation failed", fields: errors }, { status: 400 });
  }

  const { metaAdAccountId, name, objective, status = "PAUSED" } =
    body as CreateCampaignRequest;

  // ── 4. Call Meta ──────────────────────────────────────────────────────────
  try {
    const { id } = await createMetaCampaign({
      adAccountId: metaAdAccountId,
      name: name.trim(),
      objective,
      status,
    });

    const result: CreateCampaignResult = {
      metaCampaignId: id,
      name: name.trim(),
      status,
    };

    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/create-campaign] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
