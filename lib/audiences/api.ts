import type { SupabaseClient } from "@supabase/supabase-js";

import { FUNNEL_STAGE_PRESETS } from "./funnel-presets.ts";
import {
  AUDIENCE_SUBTYPE_LABELS,
  isAudienceStatus,
  isAudienceSubtype,
  isFunnelStage,
} from "./metadata.ts";
import type { Database } from "../db/database.types.ts";
import type {
  AudienceSourceMeta,
  AudienceStatus,
  AudienceSubtype,
  FunnelStage,
  MetaCustomAudienceInsert,
  MetaCustomAudienceUpdate,
} from "../types/audience.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

export type AudiencePresetBundle =
  | "top_of_funnel"
  | "mid_funnel"
  | "bottom_funnel"
  | "retargeting";

export interface AudienceCreateBody {
  clientId?: string;
  eventId?: string | null;
  funnelStage?: FunnelStage;
  audienceSubtype?: AudienceSubtype;
  retentionDays?: number;
  sourceId?: string;
  sourceIds?: Partial<Record<AudienceSubtype, string>>;
  sourceMeta?: Partial<AudienceSourceMeta> & Record<string, unknown>;
  name?: string;
  presetBundle?: AudiencePresetBundle;
  audiences?: Array<
    Omit<AudienceCreateBody, "audiences" | "presetBundle" | "createOnMeta"> & {
      enabled?: boolean;
    }
  >;
  createOnMeta?: boolean;
}

interface ClientContext {
  id: string;
  name: string;
  slug: string | null;
  meta_ad_account_id: string | null;
}

interface EventContext {
  id: string;
  client_id: string;
  name: string;
  event_code: string | null;
}

export async function buildAudienceDraftInputs(
  supabase: TypedSupabaseClient,
  userId: string,
  body: AudienceCreateBody,
): Promise<MetaCustomAudienceInsert[]> {
  if (!body.clientId) throw new Error("clientId is required");

  const [client, event] = await Promise.all([
    getClientContext(supabase, userId, body.clientId),
    body.eventId ? getEventContext(supabase, userId, body.eventId) : null,
  ]);

  if (!client) throw new Error("Client not found");
  if (!client.meta_ad_account_id) {
    throw new Error(
      "This client has no Meta ad account linked. Connect Meta in client settings first.",
    );
  }
  const metaAdAccountId = client.meta_ad_account_id;
  if (body.eventId && !event) throw new Error("Event not found");
  if (event && event.client_id !== client.id) {
    throw new Error("Event does not belong to this client");
  }

  if (body.audiences?.length) {
    const rows = await Promise.all(
      body.audiences
        .filter((audience) => audience.enabled !== false)
        .map((audience) =>
          buildAudienceDraftInputs(supabase, userId, {
            ...audience,
            clientId: client.id,
            eventId: audience.eventId ?? body.eventId ?? null,
          }),
        ),
    );
    return rows.flat();
  }

  if (body.presetBundle) {
    const presetBundle = body.presetBundle;
    if (!isFunnelStage(presetBundle)) {
      throw new Error("Invalid preset bundle");
    }
    return FUNNEL_STAGE_PRESETS[presetBundle].map((preset) => {
      const sourceId = resolveSourceId(body, preset.audienceSubtype);
      return {
        userId,
        clientId: client.id,
        eventId: event?.id ?? null,
        name: buildAudienceName({
          explicitName: undefined,
          client,
          event,
          subtype: preset.audienceSubtype,
          retentionDays: preset.retentionDays,
        }),
        funnelStage: presetBundle,
        audienceSubtype: preset.audienceSubtype,
        retentionDays: preset.retentionDays,
        sourceId,
        sourceMeta: mergeSourceMeta(
          preset.defaultSourceMeta,
          preset.audienceSubtype,
          sourceId,
          body.sourceMeta,
        ),
        metaAdAccountId,
      };
    });
  }

  if (!isFunnelStage(body.funnelStage)) throw new Error("Invalid funnel stage");
  if (!isAudienceSubtype(body.audienceSubtype)) {
    throw new Error("Invalid audience subtype");
  }
  const retentionDays = normalizeRetentionDays(body.retentionDays);
  const sourceId = resolveSourceId(body, body.audienceSubtype);

  return [
    {
      userId,
      clientId: client.id,
      eventId: event?.id ?? null,
      name: buildAudienceName({
        explicitName: body.name,
        client,
        event,
        subtype: body.audienceSubtype,
        retentionDays,
      }),
      funnelStage: body.funnelStage,
      audienceSubtype: body.audienceSubtype,
      retentionDays,
      sourceId,
      sourceMeta: mergeSourceMeta(
        { subtype: body.audienceSubtype } as AudienceSourceMeta,
        body.audienceSubtype,
        sourceId,
        body.sourceMeta,
      ),
      metaAdAccountId,
    },
  ];
}

export function parseAudienceUpdateBody(
  body: Record<string, unknown>,
): MetaCustomAudienceUpdate {
  const patch: MetaCustomAudienceUpdate = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (isFunnelStage(body.funnelStage)) patch.funnelStage = body.funnelStage;
  if (isAudienceSubtype(body.audienceSubtype)) {
    patch.audienceSubtype = body.audienceSubtype;
  }
  if (typeof body.retentionDays === "number") {
    patch.retentionDays = normalizeRetentionDays(body.retentionDays);
  }
  if (typeof body.sourceId === "string") patch.sourceId = body.sourceId.trim();
  if (body.sourceMeta && typeof body.sourceMeta === "object") {
    patch.sourceMeta = body.sourceMeta as AudienceSourceMeta;
  }
  if (isAudienceStatus(body.status)) patch.status = body.status as AudienceStatus;
  if (typeof body.statusError === "string" || body.statusError === null) {
    patch.statusError = body.statusError;
  }
  return patch;
}

async function getClientContext(
  supabase: TypedSupabaseClient,
  userId: string,
  clientId: string,
): Promise<ClientContext | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, slug, meta_ad_account_id")
    .eq("id", clientId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ClientContext | null) ?? null;
}

async function getEventContext(
  supabase: TypedSupabaseClient,
  userId: string,
  eventId: string,
): Promise<EventContext | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id, client_id, name, event_code")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as EventContext | null) ?? null;
}

function buildAudienceName({
  explicitName,
  client,
  event,
  subtype,
  retentionDays,
}: {
  explicitName?: string;
  client: ClientContext;
  event: EventContext | null;
  subtype: AudienceSubtype;
  retentionDays: number;
}): string {
  const trimmed = explicitName?.trim();
  if (trimmed) return trimmed;
  const prefix = event?.event_code || client.slug || client.name;
  return `[${prefix}] ${AUDIENCE_SUBTYPE_LABELS[subtype]} ${retentionDays}d`;
}

function resolveSourceId(
  body: AudienceCreateBody,
  subtype: AudienceSubtype,
): string {
  const sourceId = body.sourceIds?.[subtype] ?? body.sourceId ?? "";
  if (!sourceId.trim()) {
    throw new Error(`${AUDIENCE_SUBTYPE_LABELS[subtype]} source ID is required`);
  }
  return sourceId.trim();
}

function normalizeRetentionDays(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 365) {
    throw new Error("retentionDays must be between 1 and 365");
  }
  return parsed;
}

function mergeSourceMeta(
  base: AudienceSourceMeta,
  subtype: AudienceSubtype,
  sourceId: string,
  override?: Partial<AudienceSourceMeta> & Record<string, unknown>,
): AudienceSourceMeta {
  const merged = {
    ...base,
    ...(override ?? {}),
    subtype,
  } as Record<string, unknown>;
  if (subtype === "video_views") {
    const rawVideoIds =
      Array.isArray(merged.videoIds) && merged.videoIds.length > 0
        ? merged.videoIds
        : sourceId.split(",");
    const campaignIds =
      Array.isArray(merged.campaignIds) && merged.campaignIds.length > 0
        ? merged.campaignIds.map(String).map((id) => id.trim()).filter(Boolean)
        : typeof merged.campaignId === "string" && merged.campaignId.trim()
          ? [merged.campaignId.trim()]
          : [];
    const campaignSummaries = Array.isArray(merged.campaignSummaries)
      ? (merged.campaignSummaries as Array<{ id: string; name: string }>)
      : undefined;
    return {
      subtype,
      threshold: normalizeVideoThreshold(merged.threshold),
      campaignId: campaignIds[0],
      campaignIds: campaignIds.length ? campaignIds : undefined,
      campaignName:
        typeof merged.campaignName === "string" ? merged.campaignName : undefined,
      campaignSummaries,
      videoIds: rawVideoIds.map(String).map((id) => id.trim()).filter(Boolean),
    };
  }
  if (subtype === "website_pixel") {
    return {
      subtype,
      pixelEvent:
        typeof merged.pixelEvent === "string" && merged.pixelEvent
          ? merged.pixelEvent
          : "PageView",
      urlContains:
        typeof merged.urlContains === "string" ? merged.urlContains : undefined,
      pixelName:
        typeof merged.pixelName === "string" ? merged.pixelName : undefined,
    };
  }
  const pageIdsSplit = sourceId.split(",").map((s) => s.trim()).filter(Boolean);
  const pageIdsMerged = merged.pageIds;
  const pageIds =
    Array.isArray(pageIdsMerged) && pageIdsMerged.length > 0
      ? pageIdsMerged.map(String).map((s) => s.trim()).filter(Boolean)
      : pageIdsSplit;

  return {
    subtype,
    pageSlug: typeof merged.pageSlug === "string" ? merged.pageSlug : undefined,
    pageName: typeof merged.pageName === "string" ? merged.pageName : undefined,
    pageIds: pageIds.length > 0 ? pageIds : undefined,
  };
}

function normalizeVideoThreshold(value: unknown): 25 | 50 | 75 | 95 | 100 {
  if (value === 25 || value === 50 || value === 75 || value === 95 || value === 100) {
    return value;
  }
  return 50;
}
