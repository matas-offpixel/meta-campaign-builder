import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../../db/database.types.ts";
import type { CampaignDraft } from "../../types.ts";
import { parseAppUsageHeader } from "../app-usage.ts";
import { locationSearchQuery, parseLocationSearchHits } from "../location-search.ts";
import { facebookTokenForImport } from "./account.ts";
import {
  clientIdForMetaAdAccount,
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
  type CountryGroupLabel,
} from "./map.ts";
import { unlabeledImageHashes, type ImportCreativeSource } from "./creative-copy.ts";
import { buildMetaImportPicker } from "./picker.ts";
import { readMetaLiveCampaign } from "./readers.ts";
import { guardMetaImportRaw } from "./raw-guard.ts";
import { applyEventEndToDraft } from "../../wizard/event-end-date.ts";
import type {
  MetaImportGraphGet,
  MetaImportReadProgress,
  MetaLiveCampaignBundle,
} from "./types.ts";
import { META_IMPORT_EVENT_ID_CLIENT_MISMATCH } from "./types.ts";

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
  /**
   * Names for the country-group keys the ad sets target. Default is one
   * adgeolocation search per distinct key, matched on key. A key that
   * fails or has no matching hit is left out of the result.
   */
  countryGroupLabels?: CountryGroupLabelLookup;
};

export type CountryGroupLabelLookup = (
  keys: string[],
  token: string,
  get?: MetaImportGraphGet,
) => Promise<Record<string, CountryGroupLabel>>;

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

function countryGroupKeyOf(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const key = (raw as { key?: unknown }).key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

/** Distinct country-group keys across every ad set, included and excluded. */
export function countryGroupKeysOf(bundle: MetaLiveCampaignBundle): string[] {
  const keys = new Set<string>();
  for (const adSet of bundle.adSets) {
    const targeting = adSet.targeting;
    if (!targeting || typeof targeting !== "object") continue;
    for (const field of ["geo_locations", "excluded_geo_locations"]) {
      const geo = (targeting as Record<string, unknown>)[field];
      if (!geo || typeof geo !== "object") continue;
      const groups = (geo as { country_groups?: unknown }).country_groups;
      if (!Array.isArray(groups)) continue;
      for (const raw of groups) {
        const key = countryGroupKeyOf(raw);
        if (key) keys.add(key);
      }
    }
  }
  return [...keys];
}

/**
 * One adgeolocation search per distinct key, `location_types: ["country_group"]`.
 * Only a hit whose key equals the group key names it. A throw or a miss
 * leaves that key out — the mapper then keeps the key as the label.
 */
export async function defaultCountryGroupLabels(
  keys: string[],
  token: string,
  get?: MetaImportGraphGet,
): Promise<Record<string, CountryGroupLabel>> {
  const labels: Record<string, CountryGroupLabel> = {};
  const unique = [...new Set(keys)];
  if (unique.length === 0) return labels;
  let search = get;
  if (!search) {
    try {
      search = (await import("../client.ts")).graphGetWithToken;
    } catch (err) {
      console.warn(
        `[meta/import] country-group search unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return labels;
    }
  }
  for (const key of unique) {
    try {
      const raw = await search("/search", locationSearchQuery(key, ["country_group"]), token);
      const data = raw && typeof raw === "object" ? (raw as { data?: unknown }).data : undefined;
      const hit = parseLocationSearchHits(data).find(
        (row) => row.type === "country_group" && row.key === key,
      );
      if (hit) labels[key] = { name: hit.name, countryCodes: hit.country_codes };
    } catch (err) {
      console.warn(
        `[meta/import] country-group search failed key=${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return labels;
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
 * `carry: []` saves nothing. `carry: string[]` maps and saves.
 * `eventId` is optional: absent saves the Meta name verbatim and records
 * `eventAttachment: "none"`. Writes nothing to Meta.
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
  if (decision.action === "save" && eventId) {
    event = await loadEvent(input.supabase, { eventId, userId: input.userId! });
    if (!event) {
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
  const eventAttachment = event ? "event" : "none";
  console.log(
    `[meta/import] carry campaign=${guard.campaignId} received=${decision.carry.length} accepted=${accepted.length} rejected=${rejected.join(",") || "none"} eventAttachment=${eventAttachment}`,
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
  const countryGroupLabels = deps.countryGroupLabels ?? defaultCountryGroupLabels;
  const groupKeys = countryGroupKeysOf(bundle);
  const groupLabels =
    groupKeys.length > 0
      ? await countryGroupLabels(groupKeys, credentials.token, deps.graph?.get).catch((err) => {
          console.warn(
            `[meta/import] country-group labels failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return {};
        })
      : {};
  const draft = mapMetaLiveCampaign({
    bundle,
    adAccountId: guard.adAccountId,
    carry: accepted,
    availability: [],
    appUsageCallCount: appUsageCallCount(),
    clientId: event?.client_id,
    eventId: event?.id,
    eventAttachment,
    imageSizes: sizes,
    countryGroupLabels: groupLabels,
  });
  const hasPhase = Boolean(
    event?.event_date?.trim() || event?.presale_at?.trim() || event?.general_sale_at?.trim(),
  );
  const endLocked = draft.budgetSchedule.endDateSource === "operator";
  const startLocked = draft.budgetSchedule.startDateSource === "operator";
  if (hasPhase && !endLocked) {
    draft.budgetSchedule.endDate = "";
    draft.budgetSchedule.endDateSource = undefined;
    draft.budgetSchedule.endDatePhase = undefined;
  }
  if (hasPhase && !startLocked) {
    draft.budgetSchedule.startDate = "";
    draft.budgetSchedule.startDateSource = undefined;
  }
  const scheduled = hasPhase
    ? applyEventEndToDraft(draft, {
        previousEventDate: null,
        nextEventDate: event?.event_date ?? null,
        nextPresaleAt: event?.presale_at ?? null,
        nextGeneralSaleAt: event?.general_sale_at ?? null,
        now: new Date(),
        refreshStart: !startLocked,
      })
    : draft;
  try {
    await saveDraft(scheduled, input.userId!);
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
