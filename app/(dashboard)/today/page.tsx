import { ComingSoon, PageHeader } from "@/components/dashboard/page-header";

export default function TodayPage() {
  return (
    <>
      <PageHeader
        title="Today"
        description="Your live-day dashboard — moments, active campaigns, action items."
      />
      <main className="flex-1">
        <ComingSoon
          title="Today dashboard coming soon"
          description="Today's Moments, Active Campaigns Snapshot, Action Items and Upcoming This Week will land here once events and campaigns are wired up."
        />
      </main>
    </>
  );
}
