import { PageHeader } from "@/components/dashboard/page-header";
import { TikTokCampaignForm } from "@/components/tiktok/tiktok-campaign-form";

export default function NewTikTokCampaignPage() {
  return (
    <>
      <PageHeader
        title="New TikTok campaign"
        description="Skeleton form — fields render but launch is gated until the TikTok OAuth + Ads API integration lands."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <TikTokCampaignForm />
        </div>
      </main>
    </>
  );
}
