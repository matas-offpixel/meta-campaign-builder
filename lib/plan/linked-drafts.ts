import { migrateDraft } from "../autosave.ts";
import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import type { CampaignPlan } from "./types.ts";

export async function loadLinkedMetaDraft(
  supabase: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            maybeSingle: () => Promise<{
              data: { draft_json?: unknown } | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  } | unknown,
  draftId: string,
  userId: string,
): Promise<CampaignDraft | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            maybeSingle: () => Promise<{
              data: { draft_json?: unknown } | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await client
    .from("campaign_drafts")
    .select("draft_json")
    .eq("id", draftId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.draft_json) return null;
  try {
    return migrateDraft(data.draft_json as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function upsertLinkedMetaDraft(
  supabase: unknown,
  draft: CampaignDraft,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = supabase as {
    from: (table: string) => {
      upsert: (
        row: Record<string, unknown>,
        opts?: { onConflict?: string },
      ) => Promise<{ error: { message?: string } | null }>;
    };
  };
  const { error } = await client.from("campaign_drafts").upsert(
    {
      id: draft.id,
      user_id: userId,
      name: draft.settings.campaignName || null,
      objective: draft.settings.objective || null,
      status: draft.status ?? "draft",
      ad_account_id: draft.settings.adAccountId || null,
      client_id: draft.settings.clientId || null,
      event_id: draft.settings.eventId || null,
      draft_json: draft,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message ?? "campaign_drafts upsert failed" };
  return { ok: true };
}

export async function loadLinkedDraftsForPlan(
  supabase: unknown,
  plan: CampaignPlan,
): Promise<{
  meta: CampaignDraft | null;
  tiktok: TikTokCampaignDraft | null;
}> {
  const metaId = plan.launches.meta.draftId;
  const tiktokId = plan.launches.tiktok.draftId;
  const [meta, tiktok] = await Promise.all([
    metaId ? loadLinkedMetaDraft(supabase, metaId, plan.userId) : Promise.resolve(null),
    tiktokId
      ? loadLinkedTikTokDraft(supabase, tiktokId, plan.userId)
      : Promise.resolve(null),
  ]);
  return { meta, tiktok };
}

async function loadLinkedTikTokDraft(
  supabase: unknown,
  draftId: string,
  userId: string,
): Promise<TikTokCampaignDraft | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            maybeSingle: () => Promise<{
              data: { state?: unknown } | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await client
    .from("tiktok_campaign_drafts")
    .select("state")
    .eq("id", draftId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.state || typeof data.state !== "object") return null;
  return data.state as TikTokCampaignDraft;
}
