import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function BudgetScheduleStep({ draft }: { draft: TikTokCampaignDraft }) {
  return (
    <div>
      <h2 className="font-heading text-xl">Budget & schedule</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off. {draft.budgetSchedule.adGroups.length}{" "}
        ad groups planned.
      </p>
    </div>
  );
}
