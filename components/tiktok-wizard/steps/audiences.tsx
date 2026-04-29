import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function AudiencesStep({ draft }: { draft: TikTokCampaignDraft }) {
  return (
    <div>
      <h2 className="font-heading text-xl">Audiences</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off.{" "}
        {draft.audiences.interestCategoryIds.length} interest categories selected.
      </p>
    </div>
  );
}
