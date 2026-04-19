import { CampaignLibrary } from "@/components/library/campaign-library";
import { MetaConnectionWidget } from "@/components/dashboard/meta-connection-widget";

export default function Home() {
  return (
    <>
      <div className="px-6 pt-4">
        <div className="mx-auto max-w-6xl">
          <MetaConnectionWidget />
        </div>
      </div>
      <CampaignLibrary />
    </>
  );
}
