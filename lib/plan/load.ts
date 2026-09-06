import { rowToCampaignPlanIntent } from "./persist.ts";
import {
  IDLE_PLAN_LAUNCH,
  type CampaignPlan,
  type CampaignPlanLaunchRecord,
  type CampaignPlanLaunches,
} from "./types.ts";

interface LaunchRow {
  status?: CampaignPlanLaunchRecord["status"];
  platform_campaign_id?: string | null;
  draft_id?: string | null;
  error?: string | null;
  created_at?: string | null;
  platform_ad_account_id?: string | null;
}

function toLaunch(row: LaunchRow | null | undefined): CampaignPlanLaunchRecord {
  if (!row) return { ...IDLE_PLAN_LAUNCH };
  return {
    status: row.status ?? "idle",
    platformCampaignId: row.platform_campaign_id ?? null,
    draftId: row.draft_id ?? null,
    error: row.error ?? null,
    createdAt: row.created_at ?? null,
    platformAdAccountId: row.platform_ad_account_id ?? null,
    draftAdAccountId: null,
  };
}

type DraftJsonQuery = {
  select: (cols: string) => {
    eq: (col: string, value: string) => {
      maybeSingle: () => Promise<{
        data: { draft_json?: unknown } | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

type GoogleCustomerQuery = {
  select: (cols: string) => {
    eq: (col: string, value: string) => {
      maybeSingle: () => Promise<{
        data: {
          google_ads_account_id?: string | null;
          google_customer_id?: string | null;
        } | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

/** Linked Meta draft `draft_json.settings.adAccountId` — identity's second leg after launch. */
export async function loadDraftAdAccountId(
  supabase: unknown,
  draftId: string,
): Promise<string | null> {
  const client = supabase as { from: (table: string) => DraftJsonQuery };
  const { data, error } = await client
    .from("campaign_drafts")
    .select("draft_json")
    .eq("id", draftId)
    .maybeSingle();
  if (error || !data?.draft_json || typeof data.draft_json !== "object") return null;
  const settings = (data.draft_json as { settings?: Record<string, unknown> }).settings;
  const id = settings?.adAccountId ?? settings?.metaAdAccountId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Resolve `google_ads_accounts.google_customer_id` from a search-plan uuid FK. */
export async function loadGoogleCustomerIdForSearchPlan(
  supabase: unknown,
  searchPlanId: string,
): Promise<string | null> {
  const client = supabase as { from: (table: string) => GoogleCustomerQuery };
  const plan = await client
    .from("google_search_plans")
    .select("google_ads_account_id")
    .eq("id", searchPlanId)
    .maybeSingle();
  const accountId = plan.data?.google_ads_account_id?.trim();
  if (plan.error || !accountId) return null;
  const account = await client
    .from("google_ads_accounts")
    .select("google_customer_id")
    .eq("id", accountId)
    .maybeSingle();
  const customer = account.data?.google_customer_id?.trim();
  if (account.error || !customer) return null;
  return customer;
}

type LaunchQuery = {
  select: (cols: string) => {
    eq: (col: string, value: string) => {
      maybeSingle: () => Promise<{
        data: LaunchRow | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

export async function loadPlanLaunchRecords(
  supabase: { from: (table: string) => LaunchQuery } | unknown,
  planId: string,
): Promise<CampaignPlan["launches"]> {
  const client = supabase as { from: (table: string) => LaunchQuery };
  const [meta, tiktok, google] = await Promise.all([
    client.from("campaign_plan_meta_launch").select("*").eq("plan_id", planId).maybeSingle(),
    client.from("campaign_plan_tiktok_launch").select("*").eq("plan_id", planId).maybeSingle(),
    client.from("campaign_plan_google_launch").select("*").eq("plan_id", planId).maybeSingle(),
  ]);
  const launches = {
    meta: toLaunch(meta.data),
    tiktok: toLaunch(tiktok.data),
    google: toLaunch(google.data),
  };
  if (launches.meta.draftId) {
    launches.meta.draftAdAccountId = await loadDraftAdAccountId(
      supabase,
      launches.meta.draftId,
    );
  }
  return launches;
}

export function emptyPlanLaunches(): CampaignPlanLaunches {
  return {
    meta: { ...IDLE_PLAN_LAUNCH },
    tiktok: { ...IDLE_PLAN_LAUNCH },
    google: { ...IDLE_PLAN_LAUNCH },
  };
}

/** Load a saved plan plus its launch children, scoped to the owner. */
export async function loadPlanForUser(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<CampaignPlan | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await client
    .from("campaign_plans")
    .select("*")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: (row.name as string | null) ?? null,
    status: row.status as CampaignPlan["status"],
    intent: rowToCampaignPlanIntent(row as never),
    launches: await loadPlanLaunchRecords(supabase, row.id as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
