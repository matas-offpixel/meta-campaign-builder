import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function ReviewLaunchStep({ draft }: { draft: TikTokCampaignDraft }) {
  return (
    <div>
      <h2 className="font-heading text-xl">Review & launch</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off. Launch will stay disabled until the
        TikTok write API feature flag is explicitly approved for draft {draft.id}.
      </p>
    </div>
  );
}
