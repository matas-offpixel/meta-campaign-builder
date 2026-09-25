import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../../db/database.types.ts";
import type { CampaignDraft } from "../../types.ts";
import { parseAppUsageHeader } from "../app-usage.ts";
import { facebookTokenForImport } from "./account.ts";
import {
  clientIdForMetaAdAccount,
  eventRunsOnAdAccount,
  listMetaImportEvents,
  loadMetaImportEvent,
  suggestMetaImportEvent,
  type MetaImportEventRow,
  type MetaImportListedEvent,
} from "./event.ts";
import {
  classifyMetaImportCarry,
  formatRejectedMetaCarryKeys,
  mapMetaLiveCampaign,
  parseMetaImportCarry,
} from "./map.ts";
import { unlabeledImageHashes, type ImportCreativeSource } from "./creative-copy.ts";
import { buildMetaImportPicker } from "./picker.ts";
import { readMetaLiveCampaign } from "./readers.ts";
import { guardMetaImportRaw } from "./raw-guard.ts";
import type { MetaImportReadProgress, MetaLiveCampaignBundle } from "./types.ts";
import {
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
  listEvents?: typeof listMetaImportEvents;
  loadEvent?: typeof loadMetaImportEvent;
  readCampaign?: typeof readMetaLiveCampaign;
  saveDraft?: (draft: CampaignDraft, userId: string) => Promise<void>;
  appUsageCallCount?: () => number | null;
  graph?: Parameters<typeof readMetaLiveCampaign>[0]["request"];
  /**
   * One read of width and height for image hashes that have no placement
   * label. Default is `GET /act_{id}/adimages?hashes=`. Failure returns {}.
   */
  imageSizes?: (
    adAccountId: string,
    hashes: string[],
    token: string,
  ) => Promise<Record<string, { width: number; height: number }>>;
};

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

async function defaultImageSizes(
  adAccountId: string,
  hashes: string[],
  token: string,
): Promise<Record<string, { width: number; height: number }>> {
  if (hashes.length === 0) return {};
  const account = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const version = process.env.META_API_VERSION ?? "v21.0";
  const sizes: Record<string, { width: number; height: number }> = {};
  try {
    for (let i = 0; i < hashes.length; i += 50) {
      const chunk = hashes.slice(i, i + 50);
      const params = new URLSearchParams({
        access_token: token,
        hashes: JSON.stringify(chunk),
        fields: "hash,width,height",
      });
      const res = await fetch(`https://graph.facebook.com/${version}/${account}/adimages?${params}`, {
        cache: "no-store",
      });
      const payload = (await res.json()) as {
        data?: { hash?: string; width?: number; height?: number }[];
        images?: Record<string, { hash?: string; width?: number; height?: number }>;
      };
      const rows = [
        ...(payload.data ?? []),
        ...Object.values(payload.images ?? {}),
      ];
      for (const row of rows) {
        if (!row.hash || typeof row.width !== "number" || typeof row.height !== "number") continue;
        sizes[row.hash] = { width: row.width, height: row.height };
      }
    }
  } catch (err) {
    console.warn(
      `[meta/import] adimages size read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return sizes;
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
  const listEvents = deps.listEvents ?? listMetaImportEvents;
  const loadEvent = deps.loadEvent ?? loadMetaImportEvent;
  const readCampaign = deps.readCampaign ?? readMetaLiveCampaign;
  const saveDraft =
    deps.saveDraft ?? ((draft, userId) => insertImportedDraft(input.supabase, draft, userId));
  const appUsageCallCount = deps.appUsageCallCount ?? defaultAppUsage;

  const credentials = await tokenForUser(input.supabase, input.userId!);
  if ("error" in credentials) {
    return { status: credentials.status, body: { ok: false, error: credentials.error } };
  }

  let event: MetaImportEventRow | null = null;
  if (decision.action === "save") {
    event = await loadEvent(input.supabase, { eventId, userId: input.userId! });
    if (!event || !eventRunsOnAdAccount(event, guard.adAccountId)) {
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
    const events: MetaImportListedEvent[] = await listEvents(input.supabase, {
      userId: input.userId!,
      adAccountId: guard.adAccountId,
    });
    const suggestedClientId = await clientIdForAccount(input.supabase, {
      userId: input.userId!,
      adAccountId: guard.adAccountId,
    });
    return {
      status: 200,
      body: {
        ok: true,
        saved: false,
        picker: buildMetaImportPicker(bundle),
        events,
        suggestedEventId: suggestMetaImportEvent(
          typeof bundle.campaign.name === "string" ? bundle.campaign.name : "",
          events,
          suggestedClientId,
        ),
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

  const imageSizes = deps.imageSizes ?? defaultImageSizes;
  const hashes = unlabeledImageHashes(
    Object.values(bundle.creatives) as ImportCreativeSource[],
  );
  const sizes = await imageSizes(guard.adAccountId, hashes, credentials.token);
  const draft = mapMetaLiveCampaign({
    bundle,
    adAccountId: guard.adAccountId,
    carry: accepted,
    availability: [],
    appUsageCallCount: appUsageCallCount(),
    clientId: event!.client_id,
    eventId: event?.id,
    imageSizes: sizes,
  });
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
