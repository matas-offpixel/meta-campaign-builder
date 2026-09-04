import Link from "next/link";

import { loadPlanForMetaDraft } from "@/lib/plan/linked-plan";
import { createClient } from "@/lib/supabase/server";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * Renders nothing for ordinary drafts. For a draft a plan prepared, it names
 * the plan and links back, so the Meta wizard is not a one-way door.
 */
export async function PlanLinkBanner({ draftId }: { draftId: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const plan = await loadPlanForMetaDraft(supabase, draftId, user.id);
  if (!plan) return null;

  return (
    <div className={`border-b border-border bg-muted/40 px-6 py-2 ${VIZ_TYPE.label} text-muted-foreground`}>
      Part of plan{" "}
      <Link href={`/plan/${plan.id}`} className="underline">
        {plan.name?.trim() || "Untitled plan"}
      </Link>{" "}
      — TikTok and Google derive their targeting from this campaign.
    </div>
  );
}
