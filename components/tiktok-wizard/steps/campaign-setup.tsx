import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function CampaignSetupStep({ draft }: { draft: TikTokCampaignDraft }) {
  return (
    <div>
      <h2 className="font-heading text-xl">Campaign setup</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off. Campaign name:{" "}
        {draft.campaignSetup.campaignName || "not set"}.
      </p>
    </div>
  );
}
