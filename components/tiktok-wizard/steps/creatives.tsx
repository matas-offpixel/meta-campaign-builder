import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function CreativesStep({ draft }: { draft: TikTokCampaignDraft }) {
  return (
    <div>
      <h2 className="font-heading text-xl">Creatives</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off. {draft.creatives.items.length} creative
        placeholders in this draft.
      </p>
    </div>
  );
}
