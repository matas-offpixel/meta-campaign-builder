import { ComingSoon, PageHeader } from "@/components/dashboard/page-header";

export default function ReportingPage() {
  return (
    <>
      <PageHeader
        title="Reporting"
        description="Performance across Meta Ads, ticket sales, signups and spend."
      />
      <main className="flex-1">
        <ComingSoon
          title="Reporting coming soon"
          description="Per-event sales velocity, spend pacing and signup trends — the substrate for the suggestion engine — will live here."
        />
      </main>
    </>
  );
}
