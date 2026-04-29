import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function AssignCreativesStep({ draft }: { draft: TikTokCampaignDraft }) {
  return (
    <div>
      <h2 className="font-heading text-xl">Assign creatives</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off.{" "}
        {Object.keys(draft.creativeAssignments.byAdGroupId).length} assignment
        groups present.
      </p>
    </div>
  );
}
