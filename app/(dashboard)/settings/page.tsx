import { ComingSoon, PageHeader } from "@/components/dashboard/page-header";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Account, integrations and workspace preferences."
      />
      <main className="flex-1">
        <ComingSoon
          title="Settings coming soon"
          description="Integrations (Google Calendar, Slack, Google Drive), team and workspace preferences will be managed from here."
        />
      </main>
    </>
  );
}
