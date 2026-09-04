import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft, TikTokAccountSetup } from "../types/tiktok-draft.ts";
import type { GoogleSearchPlanTree } from "../google-search/types.ts";
import { normalizeAdAccountId } from "../meta/ad-account.ts";

export type ChannelDefaultProvenance = "client-default" | "operator-override" | "unset";

export interface ResolvedChannelField<T> {
  value: T | null;
  provenance: ChannelDefaultProvenance;
}

export type TikTokIdentityTypeDefault =
  | "AUTH_CODE"
  | "BC_AUTH_TT"
  | "CUSTOMIZED_USER"
  | "TT_USER"
  | "MANUAL";

export interface ClientChannelDefaultsRow {
  clientId: string;
  clientName: string | null;
  metaAdAccountId: string | null;
  metaPixelId: string | null;
  /** First entry of clients.default_page_ids — not a copied column. */
  defaultPageId: string | null;
  defaultInstagramActorId: string | null;
  tiktokAccountId: string | null;
  /** From tiktok_accounts.tiktok_advertiser_id or clients.tiktok_ad_account_id. */
  tiktokAdvertiserId: string | null;
  tiktokIdentityId: string | null;
  tiktokIdentityType: TikTokIdentityTypeDefault | null;
  tiktokIdentityBcId: string | null;
  googleAdsAccountId: string | null;
  googleAdsCustomerId: string | null;
}

export interface ChannelDefaultOverrides {
  metaAdAccountId?: string | null;
  metaPixelId?: string | null;
  facebookPageId?: string | null;
  instagramActorId?: string | null;
  tiktokAccountId?: string | null;
  tiktokAdvertiserId?: string | null;
  tiktokIdentityId?: string | null;
  tiktokIdentityType?: TikTokIdentityTypeDefault | null;
  tiktokIdentityBcId?: string | null;
  googleAdsAccountId?: string | null;
  googleAdsCustomerId?: string | null;
}

export interface ResolvedChannelDefaults {
  clientId: string | null;
  clientName: string | null;
  metaAdAccount: ResolvedChannelField<string>;
  metaPixel: ResolvedChannelField<string>;
  facebookPage: ResolvedChannelField<string>;
  instagramActor: ResolvedChannelField<string>;
  tiktokAccount: ResolvedChannelField<string>;
  tiktokAdvertiser: ResolvedChannelField<string>;
  tiktokIdentity: ResolvedChannelField<{
    id: string;
    type: TikTokIdentityTypeDefault | null;
    bcId: string | null;
  }>;
  googleAdsAccount: ResolvedChannelField<string>;
  googleAdsCustomer: ResolvedChannelField<string>;
}

function pickField<T>(
  override: T | null | undefined,
  fallback: T | null | undefined,
): ResolvedChannelField<T> {
  if (hasValue(override)) {
    return { value: override as T, provenance: "operator-override" };
  }
  if (hasValue(fallback)) {
    return { value: fallback as T, provenance: "client-default" };
  }
  return { value: null, provenance: "unset" };
}

/**
 * Same precedence as pickField, then `normalizeAdAccountId` so a bare
 * stored id (`1967530076312`) and an already-prefixed one both resolve
 * to `act_<digits>`. Invalid bodies stay unset — never `act_act_`.
 */
function pickNormalisedAdAccount(
  override: string | null | undefined,
  fallback: string | null | undefined,
): ResolvedChannelField<string> {
  const picked = pickField(override, fallback);
  if (!picked.value) return picked;
  const normalised = normalizeAdAccountId(picked.value);
  if (!normalised) return { value: null, provenance: "unset" };
  return { value: normalised, provenance: picked.provenance };
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

/**
 * (event | client stored row) + operator overrides → resolved defaults.
 * Honest unset — never invents a page, advertiser, identity, or account.
 */
export function resolveChannelDefaults(
  stored: ClientChannelDefaultsRow | null,
  overrides: ChannelDefaultOverrides = {},
): ResolvedChannelDefaults {
  const tiktokIdentityOverride =
    hasValue(overrides.tiktokIdentityId) && overrides.tiktokIdentityId
      ? {
          id: overrides.tiktokIdentityId,
          type: overrides.tiktokIdentityType ?? null,
          bcId: overrides.tiktokIdentityBcId ?? null,
        }
      : null;
  const tiktokIdentityDefault =
    stored && hasValue(stored.tiktokIdentityId)
      ? {
          id: stored.tiktokIdentityId as string,
          type: stored.tiktokIdentityType,
          bcId: stored.tiktokIdentityBcId,
        }
      : null;

  return {
    clientId: stored?.clientId ?? null,
    clientName: stored?.clientName ?? null,
    metaAdAccount: pickNormalisedAdAccount(
      overrides.metaAdAccountId,
      stored?.metaAdAccountId,
    ),
    metaPixel: pickField(overrides.metaPixelId, stored?.metaPixelId),
    facebookPage: pickField(overrides.facebookPageId, stored?.defaultPageId),
    instagramActor: pickField(overrides.instagramActorId, stored?.defaultInstagramActorId),
    tiktokAccount: pickField(overrides.tiktokAccountId, stored?.tiktokAccountId),
    tiktokAdvertiser: pickField(overrides.tiktokAdvertiserId, stored?.tiktokAdvertiserId),
    tiktokIdentity: pickField(tiktokIdentityOverride, tiktokIdentityDefault),
    googleAdsAccount: pickField(overrides.googleAdsAccountId, stored?.googleAdsAccountId),
    googleAdsCustomer: pickField(overrides.googleAdsCustomerId, stored?.googleAdsCustomerId),
  };
}

export function emptyChannelDefaultsRow(
  clientId: string,
  clientName: string | null = null,
): ClientChannelDefaultsRow {
  return {
    clientId,
    clientName,
    metaAdAccountId: null,
    metaPixelId: null,
    defaultPageId: null,
    defaultInstagramActorId: null,
    tiktokAccountId: null,
    tiktokAdvertiserId: null,
    tiktokIdentityId: null,
    tiktokIdentityType: null,
    tiktokIdentityBcId: null,
    googleAdsAccountId: null,
    googleAdsCustomerId: null,
  };
}

export function rowFromClientRecord(row: {
  id: string;
  name?: string | null;
  meta_ad_account_id?: string | null;
  meta_pixel_id?: string | null;
  default_page_ids?: string[] | null;
  default_instagram_actor_id?: string | null;
  tiktok_account_id?: string | null;
  tiktok_ad_account_id?: string | null;
  default_tiktok_identity_id?: string | null;
  default_tiktok_identity_type?: string | null;
  default_tiktok_identity_bc_id?: string | null;
  google_ads_account_id?: string | null;
  google_ads_customer_id?: string | null;
  tiktok_accounts?: { tiktok_advertiser_id?: string | null } | { tiktok_advertiser_id?: string | null }[] | null;
  google_ads_accounts?: { google_customer_id?: string | null } | { google_customer_id?: string | null }[] | null;
}): ClientChannelDefaultsRow {
  const pages = (row.default_page_ids ?? []).filter(Boolean);
  const tiktokJoin = Array.isArray(row.tiktok_accounts)
    ? row.tiktok_accounts[0]
    : row.tiktok_accounts;
  const googleJoin = Array.isArray(row.google_ads_accounts)
    ? row.google_ads_accounts[0]
    : row.google_ads_accounts;
  const type = row.default_tiktok_identity_type;
  return {
    clientId: row.id,
    clientName: row.name ?? null,
    metaAdAccountId: row.meta_ad_account_id ?? null,
    metaPixelId: row.meta_pixel_id ?? null,
    defaultPageId: pages[0] ?? null,
    defaultInstagramActorId: row.default_instagram_actor_id ?? null,
    tiktokAccountId: row.tiktok_account_id ?? null,
    tiktokAdvertiserId:
      tiktokJoin?.tiktok_advertiser_id ?? row.tiktok_ad_account_id ?? null,
    tiktokIdentityId: row.default_tiktok_identity_id ?? null,
    tiktokIdentityType: isTikTokIdentityType(type) ? type : null,
    tiktokIdentityBcId: row.default_tiktok_identity_bc_id ?? null,
    googleAdsAccountId: row.google_ads_account_id ?? null,
    googleAdsCustomerId:
      googleJoin?.google_customer_id ?? row.google_ads_customer_id ?? null,
  };
}

function isTikTokIdentityType(value: string | null | undefined): value is TikTokIdentityTypeDefault {
  return (
    value === "AUTH_CODE" ||
    value === "BC_AUTH_TT" ||
    value === "CUSTOMIZED_USER" ||
    value === "TT_USER" ||
    value === "MANUAL"
  );
}

export function isClientChannelDefaultsColumnMissing(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "42703") return true;
  return (
    message.includes("default_instagram_actor_id") ||
    message.includes("default_tiktok_identity") ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

const NEW_DEFAULT_COLUMNS = [
  "default_instagram_actor_id",
  "default_tiktok_identity_id",
  "default_tiktok_identity_type",
  "default_tiktok_identity_bc_id",
] as const;

const CLIENT_DEFAULTS_SELECT = `
  id, name,
  meta_ad_account_id, meta_pixel_id, default_page_ids,
  default_instagram_actor_id,
  tiktok_account_id, tiktok_ad_account_id,
  default_tiktok_identity_id, default_tiktok_identity_type, default_tiktok_identity_bc_id,
  google_ads_account_id, google_ads_customer_id,
  tiktok_accounts ( tiktok_advertiser_id ),
  google_ads_accounts ( google_customer_id )
`;

const CLIENT_DEFAULTS_SELECT_LEGACY = `
  id, name,
  meta_ad_account_id, meta_pixel_id, default_page_ids,
  tiktok_account_id, tiktok_ad_account_id,
  google_ads_account_id, google_ads_customer_id,
  tiktok_accounts ( tiktok_advertiser_id ),
  google_ads_accounts ( google_customer_id )
`;

export async function loadClientChannelDefaults(
  supabase: unknown,
  clientId: string,
): Promise<ClientChannelDefaultsRow | null> {
  const full = await selectClientDefaults(supabase, clientId, CLIENT_DEFAULTS_SELECT);
  if (full.ok) return full.row ? rowFromClientRecord(full.row) : null;
  if (!isClientChannelDefaultsColumnMissing(full.error)) return null;
  const legacy = await selectClientDefaults(supabase, clientId, CLIENT_DEFAULTS_SELECT_LEGACY);
  if (!legacy.ok || !legacy.row) return null;
  return rowFromClientRecord(legacy.row);
}

async function selectClientDefaults(
  supabase: unknown,
  clientId: string,
  columns: string,
): Promise<
  | { ok: true; row: Parameters<typeof rowFromClientRecord>[0] | null }
  | { ok: false; error: { code?: string; message?: string } | null }
> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: Parameters<typeof rowFromClientRecord>[0] | null;
            error: { code?: string; message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await client.from("clients").select(columns).eq("id", clientId).maybeSingle();
  if (error) return { ok: false, error };
  return { ok: true, row: data };
}

export async function loadChannelDefaultsForEvent(
  supabase: unknown,
  eventId: string | null | undefined,
): Promise<{
  stored: ClientChannelDefaultsRow | null;
  overrides: ChannelDefaultOverrides;
} | null> {
  if (!eventId) return null;
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: {
              client_id?: string | null;
              tiktok_account_id?: string | null;
              google_ads_account_id?: string | null;
            } | null;
            error: { code?: string; message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data: event, error } = await client
    .from("events")
    .select("client_id, tiktok_account_id, google_ads_account_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !event?.client_id) return null;
  let stored = await loadClientChannelDefaults(supabase, event.client_id);
  const overrides: ChannelDefaultOverrides = {};
  if (event.tiktok_account_id) {
    overrides.tiktokAccountId = event.tiktok_account_id;
    const advertiserId = await lookupJoinedId(
      supabase,
      "tiktok_accounts",
      event.tiktok_account_id,
      "tiktok_advertiser_id",
    );
    if (advertiserId) overrides.tiktokAdvertiserId = advertiserId;
    if (stored && event.tiktok_account_id !== stored.tiktokAccountId) {
      stored = {
        ...stored,
        tiktokIdentityId: null,
        tiktokIdentityType: null,
        tiktokIdentityBcId: null,
      };
    }
  }
  if (event.google_ads_account_id) {
    overrides.googleAdsAccountId = event.google_ads_account_id;
    const customerId = await lookupJoinedId(
      supabase,
      "google_ads_accounts",
      event.google_ads_account_id,
      "google_customer_id",
    );
    if (customerId) overrides.googleAdsCustomerId = customerId;
  }
  return { stored, overrides };
}

async function lookupJoinedId(
  supabase: unknown,
  table: string,
  id: string,
  column: string,
): Promise<string | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, string | null> | null;
            error: { code?: string; message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await client.from(table).select(column).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const value = data[column];
  return typeof value === "string" && value.trim() ? value : null;
}

export function applyMetaChannelDefaults(
  draft: CampaignDraft,
  resolved: ResolvedChannelDefaults,
): CampaignDraft {
  const next: CampaignDraft = {
    ...draft,
    settings: { ...draft.settings },
    creatives: draft.creatives.map((creative) => ({
      ...creative,
      identity: { ...(creative.identity ?? { pageId: "", instagramAccountId: "" }) },
    })),
  };
  const marks = { ...(next.settings.channelDefaultsApplied ?? {}) };

  const adAccountId = normalizeAdAccountId(resolved.metaAdAccount.value);
  if (!next.settings.metaAdAccountId && !next.settings.adAccountId && adAccountId) {
    next.settings.adAccountId = adAccountId;
    next.settings.metaAdAccountId = adAccountId;
  }
  if (!next.settings.metaPixelId && !next.settings.pixelId && resolved.metaPixel.value) {
    next.settings.pixelId = resolved.metaPixel.value;
    next.settings.metaPixelId = resolved.metaPixel.value;
  }
  if (!next.settings.metaPageId && resolved.facebookPage.value) {
    next.settings.metaPageId = resolved.facebookPage.value;
    if (resolved.facebookPage.provenance === "client-default") marks.facebookPage = true;
  }
  if (!next.settings.metaIGAccountId && resolved.instagramActor.value) {
    next.settings.metaIGAccountId = resolved.instagramActor.value;
    if (resolved.instagramActor.provenance === "client-default") marks.instagramActor = true;
  }

  for (const creative of next.creatives) {
    const identity = creative.identity;
    if (!identity.pageId && resolved.facebookPage.value) {
      identity.pageId = resolved.facebookPage.value;
      if (resolved.facebookPage.provenance === "client-default") marks.facebookPage = true;
    }
    if (!identity.instagramAccountId && resolved.instagramActor.value) {
      identity.instagramAccountId = resolved.instagramActor.value;
      if (resolved.instagramActor.provenance === "client-default") marks.instagramActor = true;
    }
    if (!identity.instagramActorId && resolved.instagramActor.value) {
      identity.instagramActorId = resolved.instagramActor.value;
      if (resolved.instagramActor.provenance === "client-default") marks.instagramActor = true;
    }
  }

  if (Object.keys(marks).length > 0) {
    next.settings.channelDefaultsApplied = marks;
  }
  return next;
}

/** `null` when every field already has a value — nothing to persist. */
export function fillMetaChannelDefaultsIfEmpty(
  draft: CampaignDraft,
  resolved: ResolvedChannelDefaults,
): CampaignDraft | null {
  const next = applyMetaChannelDefaults(draft, resolved);
  const changed =
    next.settings.adAccountId !== draft.settings.adAccountId ||
    next.settings.metaAdAccountId !== draft.settings.metaAdAccountId ||
    next.settings.pixelId !== draft.settings.pixelId ||
    next.settings.metaPixelId !== draft.settings.metaPixelId ||
    next.settings.metaPageId !== draft.settings.metaPageId ||
    next.settings.metaIGAccountId !== draft.settings.metaIGAccountId ||
    next.creatives.some((creative, index) => {
      const prev = draft.creatives[index];
      return (
        creative.identity?.pageId !== prev?.identity?.pageId ||
        creative.identity?.instagramAccountId !== prev?.identity?.instagramAccountId
      );
    });
  return changed ? next : null;
}

export function applyTikTokChannelDefaults(
  draft: TikTokCampaignDraft,
  resolved: ResolvedChannelDefaults,
): TikTokCampaignDraft {
  const setup: TikTokAccountSetup = { ...draft.accountSetup };
  if (!setup.tiktokAccountId && resolved.tiktokAccount.value) {
    setup.tiktokAccountId = resolved.tiktokAccount.value;
  }
  if (!setup.advertiserId && resolved.tiktokAdvertiser.value) {
    setup.advertiserId = resolved.tiktokAdvertiser.value;
  }
  if (!setup.identityId && resolved.tiktokIdentity.value) {
    setup.identityId = resolved.tiktokIdentity.value.id;
    setup.identityType = resolved.tiktokIdentity.value.type;
    setup.identityBcId = resolved.tiktokIdentity.value.bcId;
  }
  return { ...draft, accountSetup: setup };
}

export function fillTikTokChannelDefaultsIfEmpty(
  draft: TikTokCampaignDraft,
  resolved: ResolvedChannelDefaults,
): TikTokCampaignDraft | null {
  const next = applyTikTokChannelDefaults(draft, resolved);
  const changed =
    next.accountSetup.tiktokAccountId !== draft.accountSetup.tiktokAccountId ||
    next.accountSetup.advertiserId !== draft.accountSetup.advertiserId ||
    next.accountSetup.identityId !== draft.accountSetup.identityId;
  return changed ? next : null;
}

export function applyGoogleChannelDefaults(
  tree: GoogleSearchPlanTree,
  resolved: ResolvedChannelDefaults,
): GoogleSearchPlanTree {
  if (tree.plan.google_ads_account_id || !resolved.googleAdsAccount.value) return tree;
  return {
    ...tree,
    plan: { ...tree.plan, google_ads_account_id: resolved.googleAdsAccount.value },
  };
}

export function fillGoogleChannelDefaultsIfEmpty(
  tree: GoogleSearchPlanTree,
  resolved: ResolvedChannelDefaults,
): GoogleSearchPlanTree | null {
  const next = applyGoogleChannelDefaults(tree, resolved);
  return next.plan.google_ads_account_id !== tree.plan.google_ads_account_id ? next : null;
}

export function clientSettingsHref(clientId: string | null | undefined): string | null {
  if (!clientId) return null;
  return `/clients/${clientId}`;
}

export function annotateChannelDefaultCures<
  T extends { message: string; field?: string; id?: string; href?: string },
>(issues: T[], client: { id: string; name: string | null } | null): Array<T & { href?: string }> {
  if (!client) return issues;
  const name = client.name?.trim() || "this client";
  const href = clientSettingsHref(client.id) ?? undefined;
  return issues.map((issue) => {
    const message = issue.message;
    if (/TikTok advertiser is required/i.test(message)) {
      return {
        ...issue,
        message: `no default TikTok advertiser for ${name} — set it in client settings`,
        href,
      };
    }
    if (/Select a TikTok identity/i.test(message)) {
      return {
        ...issue,
        message: `no default TikTok identity for ${name} — set it in client settings`,
        href,
      };
    }
    if (/Pick a Google Ads account/i.test(message)) {
      return {
        ...issue,
        message: `no default Google Ads account for ${name} — set it in client settings`,
        href,
      };
    }
    if (/Facebook page ID is required/i.test(message)) {
      return {
        ...issue,
        message: `no default Facebook page for ${name} — set it in client settings`,
        href,
      };
    }
    if (/Ad account ID is required/i.test(message) || /Ad account ID must start/i.test(message)) {
      return {
        ...issue,
        message: `no default Meta ad account for ${name} — set it in client settings`,
        href,
      };
    }
    return issue;
  });
}

export { NEW_DEFAULT_COLUMNS };
