export interface LinkedPlanSummary {
  id: string;
  name: string | null;
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

  const link = await client
    .from("campaign_plan_meta_launch")
    .select("plan_id")
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
  };
}
