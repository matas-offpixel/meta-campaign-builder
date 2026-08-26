import { PlanLinkBanner } from "@/components/plan/plan-link-banner";
import { WizardShell } from "@/components/wizard/wizard-shell";

export default async function CampaignPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return (
    <>
      <PlanLinkBanner draftId={id} />
      <WizardShell draftId={id} />
    </>
  );
}
