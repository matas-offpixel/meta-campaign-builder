import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function OptimisationStrategyStep({
  draft,
}: {
  draft: TikTokCampaignDraft;
}) {
  return (
    <div>
      <h2 className="font-heading text-xl">Optimisation strategy</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off. Smart+ is{" "}
        {draft.optimisation.smartPlusEnabled ? "enabled" : "disabled"}.
      </p>
    </div>
  );
}
