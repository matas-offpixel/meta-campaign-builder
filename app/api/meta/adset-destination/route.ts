import { graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import {
  ADSET_DESTINATION_WRITES_DISABLED_MESSAGE,
  adsetDestinationWritesEnabled,
  applyAdSetDestinationChanges,
  planAdSetDestinationChanges,
  type AdSetDestinationSnapshot,
} from "@/lib/meta/adset-destination-write";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const META_OBJECT_ID = /^[0-9]{5,32}$/;
const MAX_AD_SETS = 12;

interface DestinationBody {
  draftId?: string;
  adSetIds?: string[];
  commit?: boolean;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: DestinationBody;
  try {
    body = (await request.json()) as DestinationBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const draftId = body.draftId?.trim() ?? "";
  const adSetIds = Array.isArray(body.adSetIds)
    ? body.adSetIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const commit = body.commit === true;

  if (!isUuid(draftId)) {
    return Response.json({ error: "draftId is required" }, { status: 400 });
  }
  if (adSetIds.length === 0 || adSetIds.length > MAX_AD_SETS) {
    return Response.json({ error: `Choose 1 to ${MAX_AD_SETS} ad sets` }, { status: 400 });
  }

  if (commit && !adsetDestinationWritesEnabled()) {
    return Response.json(
      { error: ADSET_DESTINATION_WRITES_DISABLED_MESSAGE },
      { status: 403 },
    );
  }

  const { data: row, error: draftError } = await supabase
    .from("campaign_drafts")
    .select("id, status, event_id, draft_json")
    .eq("id", draftId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (draftError || !row) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (row.status !== "published") {
    return Response.json({ error: "Only a published campaign can be updated" }, { status: 400 });
  }
  const draftJson = row.draft_json as { metaCampaignId?: unknown } | null;
  const campaignId =
    typeof draftJson?.metaCampaignId === "string" ? draftJson.metaCampaignId.trim() : "";
  if (!META_OBJECT_ID.test(campaignId)) {
    return Response.json({ error: "This campaign has no Meta campaign id" }, { status: 400 });
  }

  let token: string;
  try {
    token = (await resolveServerMetaToken(supabase, user.id)).token;
  } catch (err) {
    const message = err instanceof Error ? err.message : "No Meta access token";
    return Response.json({ error: message }, { status: 400 });
  }

  const graph = {
    read: async (adSetId: string): Promise<AdSetDestinationSnapshot | null> => {
      const read = await graphGetWithToken<{
        id?: string;
        name?: string;
        effective_status?: string;
        campaign_id?: string;
        destination_type?: string;
      }>(
        `/${adSetId}`,
        { fields: "name,destination_type,effective_status,campaign_id" },
        token,
      );
      if (!read?.id) return null;
      return {
        id: read.id,
        name: read.name ?? "",
        effectiveStatus: read.effective_status ?? "",
        campaignId: read.campaign_id ?? "",
        // Absent and Meta's "UNDEFINED" are the same thing to the caller.
        destinationType: read.destination_type ?? "",
      };
    },
    // The whole write. No other field is sent.
    write: async (adSetId: string, destinationType: string) => {
      await graphPostWithToken(`/${adSetId}`, { destination_type: destinationType }, token);
    },
  };

  const shared = { adSetIds, campaignId, graph };

  if (!commit) {
    const results = await planAdSetDestinationChanges(shared);
    return Response.json({ results });
  }

  let ledger;
  try {
    ledger = {
      supabase: createServiceRoleClient(),
      userId: user.id,
      draftId,
      eventId: row.event_id && isUuid(row.event_id) ? row.event_id : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Write ledger is unavailable";
    return Response.json({ error: message }, { status: 503 });
  }

  const results = await applyAdSetDestinationChanges({
    ...shared,
    writesEnabled: true,
    ledger,
  });
  return Response.json({ results });
}
