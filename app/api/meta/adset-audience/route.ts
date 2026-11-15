import { graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import {
  ADSET_TARGETING_WRITES_DISABLED_MESSAGE,
  adsetTargetingWritesEnabled,
  applyAdSetAudienceChanges,
  planAdSetAudienceChanges,
  type AdSetTargetingSnapshot,
  type AudienceListAction,
  type AudienceListDirection,
} from "@/lib/meta/adset-targeting-write";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const META_OBJECT_ID = /^[0-9]{5,32}$/;
const MAX_AD_SETS = 12;

interface PushBody {
  draftId?: string;
  audienceId?: string;
  audienceName?: string;
  direction?: string;
  action?: string;
  adSetIds?: string[];
  commit?: boolean;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isDirection(value: string): value is AudienceListDirection {
  return value === "include" || value === "exclude";
}

function isAction(value: string): value is AudienceListAction {
  return value === "add" || value === "remove";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: PushBody;
  try {
    body = (await request.json()) as PushBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const draftId = body.draftId?.trim() ?? "";
  const audienceId = body.audienceId?.trim() ?? "";
  const audienceName = body.audienceName?.trim() ?? "";
  const direction = body.direction ?? "";
  const action = body.action ?? "";
  const adSetIds = Array.isArray(body.adSetIds)
    ? body.adSetIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const commit = body.commit === true;

  if (!isUuid(draftId)) {
    return Response.json({ error: "draftId is required" }, { status: 400 });
  }
  if (!META_OBJECT_ID.test(audienceId) || !audienceName) {
    return Response.json({ error: "audience id and name are required" }, { status: 400 });
  }
  if (!isDirection(direction) || !isAction(action)) {
    return Response.json({ error: "direction and action are required" }, { status: 400 });
  }
  if (adSetIds.length === 0 || adSetIds.length > MAX_AD_SETS) {
    return Response.json({ error: `Choose 1 to ${MAX_AD_SETS} ad sets` }, { status: 400 });
  }

  if (commit && !adsetTargetingWritesEnabled()) {
    return Response.json(
      { error: ADSET_TARGETING_WRITES_DISABLED_MESSAGE },
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
    return Response.json(
      { error: "This campaign has no Meta campaign id" },
      { status: 400 },
    );
  }

  let token: string;
  try {
    token = (await resolveServerMetaToken(supabase, user.id)).token;
  } catch (err) {
    const message = err instanceof Error ? err.message : "No Meta access token";
    return Response.json({ error: message }, { status: 400 });
  }

  const graph = {
    read: async (adSetId: string): Promise<AdSetTargetingSnapshot | null> => {
      const read = await graphGetWithToken<{
        id?: string;
        name?: string;
        effective_status?: string;
        campaign_id?: string;
        targeting?: Record<string, unknown>;
      }>(
        `/${adSetId}`,
        { fields: "name,effective_status,campaign_id,targeting" },
        token,
      );
      if (!read?.id) return null;
      if (!read.targeting || typeof read.targeting !== "object" || Array.isArray(read.targeting)) {
        return null;
      }
      return {
        id: read.id,
        name: read.name ?? "",
        effectiveStatus: read.effective_status ?? "",
        campaignId: read.campaign_id ?? "",
        targeting: read.targeting,
      };
    },
    write: async (adSetId: string, targeting: Record<string, unknown>) => {
      await graphPostWithToken(`/${adSetId}`, { targeting }, token);
    },
  };

  const shared = {
    adSetIds,
    audience: { id: audienceId, name: audienceName },
    direction,
    action,
    campaignId,
    graph,
  };

  if (!commit) {
    const results = await planAdSetAudienceChanges(shared);
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

  const results = await applyAdSetAudienceChanges({
    ...shared,
    writesEnabled: true,
    ledger,
  });
  return Response.json({ results });
}
