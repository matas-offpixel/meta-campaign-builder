/**
 * GET /api/meta/campaigns/[campaignId]
 *
 * One live campaign, by id, for Add to campaign. This is a direct
 * GET /{campaignId}, not a name filter over the account list — an
 * archived campaign must come back as archived (#985), not as missing.
 */

import { campaignGoneReason } from "@/lib/meta/campaign-ledger";
import {
  fetchCampaignByIdForLedger,
  MetaApiError,
  type RawMetaCampaign,
} from "@/lib/meta/client";
import {
  classifyLaunchMetaCode,
} from "@/lib/meta/launch-error-classify";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import {
  decideAddToCampaign,
  type LiveCampaignForAdd,
} from "@/lib/library/add-to-campaign";
import { createClient } from "@/lib/supabase/server";

function toLive(raw: RawMetaCampaign): LiveCampaignForAdd {
  return {
    id: raw.id,
    name: raw.name ?? "",
    objective: raw.objective ?? "",
    status: raw.status ?? "",
    effectiveStatus: raw.effective_status,
    buyingType: raw.buying_type,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const id = campaignId.trim();
  if (!/^\d{5,}$/.test(id)) {
    return Response.json(
      { error: "Campaign id must be a Meta campaign id." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    console.error("[/api/meta/campaigns/:id] token resolution failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }

  try {
    const raw = await fetchCampaignByIdForLedger(id, token);
    const decision = decideAddToCampaign(toLive(raw), new Date().toISOString());
    if (!decision.ok) {
      return Response.json({ error: decision.message }, { status: 409 });
    }
    return Response.json({ campaign: decision.campaign });
  } catch (err) {
    const code = err instanceof MetaApiError ? err.code : undefined;
    const subcode = err instanceof MetaApiError ? err.subcode : undefined;
    if (campaignGoneReason(code, subcode)) {
      return Response.json(
        { error: `Campaign ${id} was not found in Meta.` },
        { status: 404 },
      );
    }
    if (classifyLaunchMetaCode(code) === "rate_limit") {
      return Response.json(
        { error: `Meta rate limit reached (#${code}) — retry after the window resets.` },
        { status: 429 },
      );
    }
    console.error(
      `[/api/meta/campaigns/:id] read failed id=${id} code=${code ?? "?"}`,
    );
    return Response.json(
      { error: "Could not read the campaign from Meta. Retry." },
      { status: 502 },
    );
  }
}
