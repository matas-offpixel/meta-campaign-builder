import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../../db/database.types.ts";
import type { CampaignDraft } from "../../types.ts";
import { parseAppUsageHeader } from "../app-usage.ts";
import { facebookTokenForImport } from "./account.ts";
import {
  clientIdForMetaAdAccount,
  eventBelongsToClient,
  loadMetaImportEvent,
  type MetaImportEventRow,
} from "./event.ts";
import {
  classifyMetaImportCarry,
  formatRejectedMetaCarryKeys,
  mapMetaLiveCampaign,
  parseMetaImportCarry,
} from "./map.ts";
import type { MetaAudienceAvailability } from "./map.ts";
import { buildMultiGetBatch } from "../graph-multi-get-parse.ts";
import {
  applyResolvedPageAudiences,
  readCustomAudienceRules,
  type AudienceRuleBatch,
} from "./page-audiences.ts";
import { buildMetaImportPicker } from "./picker.ts";
import { readMetaLiveCampaign } from "./readers.ts";
import { guardMetaImportRaw } from "./raw-guard.ts";
import type { MetaImportReadProgress, MetaLiveCampaignBundle } from "./types.ts";
import {
  META_IMPORT_ACCOUNT_NOT_LINKED,
  META_IMPORT_EVENT_ID_CLIENT_MISMATCH,
  META_IMPORT_EVENT_ID_REQUIRED,
} from "./types.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

export type MetaImportResult = {
  status: number;
  body: Record<string, unknown>;
};

export type MetaImportHandleDeps = {
  tokenForUser?: typeof facebookTokenForImport;
  clientIdForAccount?: typeof clientIdForMetaAdAccount;
  loadEvent?: typeof loadMetaImportEvent;
  readCampaign?: typeof readMetaLiveCampaign;
  saveDraft?: (draft: CampaignDraft, userId: string) => Promise<void>;
  audienceAvailability?: (
    ids: string[],
    token: string,
  ) => Promise<MetaAudienceAvailability[]>;
  appUsageCallCount?: () => number | null;
  graph?: Parameters<typeof readMetaLiveCampaign>[0]["request"];
  postAudienceBatch?: (batch: ReturnType<typeof buildMultiGetBatch>, token: string) => Promise<AudienceRuleBatch>;
};

async function postAudienceRuleBatch(
  batch: ReturnType<typeof buildMultiGetBatch>,
  token: string,
): Promise<AudienceRuleBatch> {
  const version = process.env.META_API_VERSION ?? "v21.0";
  const body = new URLSearchParams();
  body.set("access_token", token);
  body.set("batch", JSON.stringify(batch));
  body.set("include_headers", "false");
  const res = await fetch(`https://graph.facebook.com/${version}/`, {
    method: "POST",
    body,
    cache: "no-store",
  });
  const data: unknown = await res.json();
  return {
    responses: Array.isArray(data) ? data : [],
    usageHeader: res.headers.get("x-app-usage"),
  };
}

function audienceIds(bundle: MetaLiveCampaignBundle): string[] {
  const ids = new Set<string>();
  for (const adSet of bundle.adSets) {
    const targeting = adSet.targeting;
    if (!targeting || typeof targeting !== "object" || Array.isArray(targeting)) continue;
    const audiences = (targeting as { custom_audiences?: unknown }).custom_audiences;
    if (!Array.isArray(audiences)) continue;
    for (const audience of audiences) {
      if (audience && typeof audience === "object" && "id" in audience) {
        const id = (audience as { id?: unknown }).id;
        if (typeof id === "string" && id) ids.add(id);
      }
    }
  }
  return [...ids];
}

async function defaultAvailability(
  ids: string[],
  token: string,
): Promise<MetaAudienceAvailability[]> {
  const { fetchCustomAudienceAvailability } = await import("../client.ts");
  const rows = await fetchCustomAudienceAvailability(ids, token);
  return rows.map((row) => ({ id: row.id, available: row.available }));
}

/**
 * Written with the route's session client. `saveDraftToDb` builds a
 * browser client and only warns on error, which reported `saved: true`
 * for a row that was never written.
 */
export async function insertImportedDraft(
  supabase: TypedSupabaseClient,
  draft: CampaignDraft,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from("campaign_drafts").insert({
    id: draft.id,
    user_id: userId,
    name: draft.settings.campaignName || null,
    objective: draft.settings.objective || null,
    status: draft.status ?? "draft",
    ad_account_id: draft.settings.adAccountId || null,
    client_id: draft.settings.clientId || null,
    event_id: draft.settings.eventId || null,
    draft_json: draft as unknown as Json,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Draft save failed: ${error.message}`);
}

function defaultAppUsage(): number | null {
  return null;
}

export function metaImportUsageCallCount(header: string | null | undefined): number | null {
  return parseAppUsageHeader(header)?.callCountPercent ?? null;
}

function progressOf(err: unknown): MetaImportReadProgress | null {
  if (!err || typeof err !== "object" || !("metaImportProgress" in err)) return null;
  const progress = (err as { metaImportProgress?: MetaImportReadProgress }).metaImportProgress;
  return progress ?? null;
}

/**
 * No `carry` → read and return the picker, save nothing.
 * `carry: []` saves nothing. `carry: string[]` maps and saves, and
 * requires `eventId` on the resolved client. Writes nothing to Meta.
 */
export async function handleMetaImport(input: {
  userId: string | null;
  body: Record<string, unknown>;
  supabase: TypedSupabaseClient;
  deps?: MetaImportHandleDeps;
}): Promise<MetaImportResult> {
  const adAccountId = typeof input.body.adAccountId === "string" ? input.body.adAccountId : null;
  const campaignId = typeof input.body.campaignId === "string" ? input.body.campaignId : null;
  const guard = guardMetaImportRaw({
    adAccountId,
    campaignId,
    userId: input.userId,
  });
  if (!guard.ok) return { status: guard.status, body: { ok: false, error: guard.error } };

  const decision = parseMetaImportCarry(input.body);
  if (decision.action === "nosave") {
    return { status: 200, body: { ok: true, saved: false, draft: null } };
  }

  const eventId = typeof input.body.eventId === "string" ? input.body.eventId.trim() : "";
  if (decision.action === "save" && !eventId) {
    return { status: 400, body: { ok: false, error: META_IMPORT_EVENT_ID_REQUIRED } };
  }

  const deps = input.deps ?? {};
  const tokenForUser = deps.tokenForUser ?? facebookTokenForImport;
  const clientIdForAccount = deps.clientIdForAccount ?? clientIdForMetaAdAccount;
  const loadEvent = deps.loadEvent ?? loadMetaImportEvent;
  const readCampaign = deps.readCampaign ?? readMetaLiveCampaign;
  const saveDraft =
    deps.saveDraft ?? ((draft, userId) => insertImportedDraft(input.supabase, draft, userId));
  const audienceAvailability = deps.audienceAvailability ?? defaultAvailability;
  const appUsageCallCount = deps.appUsageCallCount ?? defaultAppUsage;

  const credentials = await tokenForUser(input.supabase, input.userId!);
  if ("error" in credentials) {
    return { status: credentials.status, body: { ok: false, error: credentials.error } };
  }

  const clientId = await clientIdForAccount(input.supabase, {
    userId: input.userId!,
    adAccountId: guard.adAccountId,
  });

  let event: MetaImportEventRow | null = null;
  if (decision.action === "save") {
    if (!clientId) {
      return { status: 400, body: { ok: false, error: META_IMPORT_ACCOUNT_NOT_LINKED } };
    }
    event = await loadEvent(input.supabase, { eventId, userId: input.userId! });
    if (!eventBelongsToClient(event, clientId)) {
      return { status: 400, body: { ok: false, error: META_IMPORT_EVENT_ID_CLIENT_MISMATCH } };
    }
  }

  if (!deps.graph && !deps.readCampaign) {
    const { graphGetWithToken, graphPostWithToken } = await import("../client.ts");
    deps.graph = { get: graphGetWithToken, post: graphPostWithToken };
  }

  let bundle: MetaLiveCampaignBundle;
  try {
    bundle = await readCampaign({
      adAccountId: guard.adAccountId,
      campaignId: guard.campaignId,
      token: credentials.token,
      request: deps.graph ?? {
        get: async () => {
          throw new Error("Meta import failed: no graph request");
        },
        post: async () => {
          throw new Error("Meta import failed: no graph request");
        },
      },
    });
  } catch (err) {
    return {
      status: 502,
      body: {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        progress: progressOf(err),
        appUsageCallCount: appUsageCallCount(),
      },
    };
  }

  if (decision.action === "picker") {
    return {
      status: 200,
      body: {
        ok: true,
        saved: false,
        picker: buildMetaImportPicker(bundle),
        clientId,
        appUsageCallCount: appUsageCallCount(),
      },
    };
  }

  const { accepted, rejected } = classifyMetaImportCarry(bundle, decision.carry);
  console.log(
    `[meta/import] carry campaign=${guard.campaignId} received=${decision.carry.length} accepted=${accepted.length} rejected=${rejected.join(",") || "none"}`,
  );
  if (rejected.length > 0) {
    return {
      status: 400,
      body: { ok: false, saved: false, error: formatRejectedMetaCarryKeys(rejected), rejected },
    };
  }

  const availability = await audienceAvailability(audienceIds(bundle), credentials.token);
  let draft = mapMetaLiveCampaign({
    bundle,
    adAccountId: guard.adAccountId,
    carry: accepted,
    availability,
    appUsageCallCount: appUsageCallCount(),
    clientId: clientId ?? undefined,
    eventId: event?.id,
  });
  const audienceRuleIds = draft.audiences.customAudienceGroups.flatMap((group) => group.audienceIds);
  if (audienceRuleIds.length > 0) {
    try {
      const postAudienceBatch = deps.postAudienceBatch ?? postAudienceRuleBatch;
      const rules = await readCustomAudienceRules({
        ids: audienceRuleIds,
        postBatch: (batch) => postAudienceBatch(batch, credentials.token),
      });
      console.log(
        `[meta/import] audience rules calls=${rules.calls} read=${rules.reads.length} stopped=${rules.stopped ?? "no"}`,
      );
      draft = applyResolvedPageAudiences(draft, rules.reads);
    } catch (err) {
      console.error(
        `[meta/import] audience rule read failed, audiences stay under Custom: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  try {
    await saveDraft(draft, input.userId!);
  } catch (err) {
    return {
      status: 500,
      body: { ok: false, saved: false, error: err instanceof Error ? err.message : String(err) },
    };
  }
  return {
    status: 200,
    body: { ok: true, saved: true, draftId: draft.id, importMeta: draft.importMeta },
  };
}
