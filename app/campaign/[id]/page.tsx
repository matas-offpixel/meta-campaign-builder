import { PlanLinkBanner } from "@/components/plan/plan-link-banner";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { loadPlanForMetaDraft } from "@/lib/plan/linked-plan";
import { createClient } from "@/lib/supabase/server";

export default async function CampaignPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const linkedPlan = user
    ? await loadPlanForMetaDraft(supabase, id, user.id)
    : null;

  return (
    <>
      <PlanLinkBanner draftId={id} />
      <WizardShell draftId={id} linkedPlan={linkedPlan} />
    </>
  );
}
