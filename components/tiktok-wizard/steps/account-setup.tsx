import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function AccountSetupStep({ draft }: { draft: TikTokCampaignDraft }) {
  return (
    <Placeholder
      title="Account setup"
      detail={`Advertiser: ${draft.accountSetup.advertiserId ?? "not selected"}`}
    />
  );
}

function Placeholder({ title, detail }: { title: string; detail: string }) {
  return (
    <div>
      <h2 className="font-heading text-xl">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Coming in PR-D / morning sign-off. {detail}
      </p>
    </div>
  );
}
