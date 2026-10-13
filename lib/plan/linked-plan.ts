import type { CampaignPlanLaunchStatus } from "./types.ts";
import type { WizardMode } from "../types.ts";

export interface LinkedPlanSummary {
  id: string;
  name: string | null;
}

/** Meta loader also returns the launch-row status the canvas-ownership rule reads. */
export interface LinkedMetaPlanSummary extends LinkedPlanSummary {
  metaLaunchStatus: CampaignPlanLaunchStatus;
}

export interface PlanOwnsLaunchInput {
  wizardMode: WizardMode | null | undefined;
  planLaunchStatus: CampaignPlanLaunchStatus | null | undefined;
  draftStatus: "draft" | "published" | "archived" | null | undefined;
}

/**
 * The plan canvas takes Launch only for an unpublished new campaign whose
 * Meta row has not launched (`idle` or `failed`). `"new"` is the
 * new-campaign wizard mode. Attach modes, a published draft, and a live
 * (or still launching, or skipped) row stay on the creator.
 */
export function planOwnsLaunch(input: PlanOwnsLaunchInput): boolean {
  if ((input.wizardMode ?? "new") !== "new") return false;
  if (input.draftStatus === "published") return false;
  return input.planLaunchStatus === "idle" || input.planLaunchStatus === "failed";
}

export function parsePlanLaunchStatus(value: unknown): CampaignPlanLaunchStatus {
  if (
    value === "idle" ||
    value === "launching" ||
    value === "live" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }
  return "idle";
}

/**
 * Reverse lookup: which plan (if any) owns this Meta draft?
 *
 * Entry into a wizard can come from either direction — the plan card, or the
 * campaign library — so a draft prepared by a plan needs a way home. Returns
 * null for every ordinary draft, which is the overwhelming majority.
 */
export async function loadPlanForMetaDraft(
  supabase: unknown,
  draftId: string,
  userId: string,
): Promise<LinkedMetaPlanSummary | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: unknown;
          }>;
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

  const link = await client
    .from("campaign_plan_meta_launch")
    .select("plan_id, status")
    .eq("draft_id", draftId)
    .maybeSingle();
  const planId = (link.data?.plan_id as string | undefined) ?? null;
  if (link.error || !planId) return null;

  const plan = await client
    .from("campaign_plans")
    .select("id, name")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();
  if (plan.error || !plan.data) return null;
  return {
    id: plan.data.id as string,
    name: (plan.data.name as string | null) ?? null,
    metaLaunchStatus: parsePlanLaunchStatus(link.data?.status),
  };
}

/** Same reverse lookup for a TikTok draft (`campaign_plan_tiktok_launch`). */
export async function loadPlanForTikTokDraft(
  supabase: unknown,
  draftId: string,
  userId: string,
): Promise<LinkedPlanSummary | null> {
  return loadPlanForLaunchDraft(supabase, "campaign_plan_tiktok_launch", draftId, userId);
}

/** Same reverse lookup for a Google Search plan (`campaign_plan_google_launch`). */
export async function loadPlanForGoogleDraft(
  supabase: unknown,
  draftId: string,
  userId: string,
): Promise<LinkedPlanSummary | null> {
  return loadPlanForLaunchDraft(supabase, "campaign_plan_google_launch", draftId, userId);
}

async function loadPlanForLaunchDraft(
  supabase: unknown,
  table: string,
  draftId: string,
  userId: string,
): Promise<LinkedPlanSummary | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: unknown;
          }>;
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

  const link = await client.from(table).select("plan_id").eq("draft_id", draftId).maybeSingle();
  const planId = (link.data?.plan_id as string | undefined) ?? null;
  if (link.error || !planId) return null;

  const plan = await client
    .from("campaign_plans")
    .select("id, name")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();
  if (plan.error || !plan.data) return null;
  return {
    id: plan.data.id as string,
    name: (plan.data.name as string | null) ?? null,
  };
}
