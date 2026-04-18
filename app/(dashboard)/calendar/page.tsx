import { ComingSoon, PageHeader } from "@/components/dashboard/page-header";

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        title="Calendar"
        description="Scheduled activity across channels — Social, Email, SMS, WhatsApp, Meta, TikTok."
      />
      <main className="flex-1">
        <ComingSoon
          title="Calendar view coming soon"
          description="Activity calendar filtered by content type will appear here once events + integrations are connected."
        />
      </main>
    </>
  );
}
