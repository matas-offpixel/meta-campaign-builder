import Link from "next/link";

import { requireClientContext } from "@/lib/auth/get-client-context";
import {
  countClientSignups,
  listClientPages,
  type ClientPageSummary,
} from "@/lib/db/client-admin";
import { MetricGrid, MetricStat, Section } from "@/components/admin/ui/section";

/**
 * app/admin/[clientSlug]/page.tsx — client dashboard home (OP909 Phase 1).
 *
 * At-a-glance state: landing pages (with per-page signup counts + status)
 * and the total fan count. Management CRUD lands in Phase 3 (/pages);
 * this home stays a read-only overview.
 */
export default async function ClientDashboardHome({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);

  const [pages, totalSignups] = await Promise.all([
    listClientPages(membership.clientId),
    countClientSignups(membership.clientId),
  ]);
  const livePages = pages.filter((p) => p.status === "live").length;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="admin-heading text-[28px] leading-none">Dashboard</h1>
      <p className="mt-2 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
        Your landing pages and fan signups at a glance.
      </p>

      <div className="mt-8">
        <MetricGrid>
          <MetricStat label="Landing pages" value={pages.length} />
          <MetricStat label="Live pages" value={livePages} />
          <MetricStat label="Total fan signups" value={totalSignups} />
        </MetricGrid>
      </div>

      <Section title="Landing pages">
        {pages.length === 0 ? (
          <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
            No landing pages yet. Create one in the Pages tab.
          </p>
        ) : (
          <div>
            {pages.map((page) => (
              <PageRow
                key={page.pageEventId}
                page={page}
                clientSlug={membership.clientSlug}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  live: "bg-[#e8f5e9] text-[#1b5e20]",
  draft: "bg-[#fff8e1] text-[#8d6e00]",
  archived: "bg-[#f0f0f0] text-[#666]",
};

function PageRow({
  page,
  clientSlug,
}: {
  page: ClientPageSummary;
  clientSlug: string;
}) {
  const presale = page.presaleAt
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      }).format(new Date(page.presaleAt))
    : "—";
  return (
    <div className="flex items-center gap-4 border-b-[0.5px] border-black py-3.5">
      <span className="admin-heading min-w-0 flex-1 truncate text-[14px]">
        {page.eventName}
      </span>
      <span
        className={`shrink-0 px-1.5 py-0.5 font-[family-name:var(--admin-mono)] text-[10px] uppercase tracking-[0.5px] ${
          STATUS_STYLES[page.status] ?? STATUS_STYLES.draft
        }`}
      >
        {page.status}
      </span>
      <span className="w-20 shrink-0 text-right font-[family-name:var(--admin-mono)] text-[12px] tabular-nums">
        {page.signupCount}
      </span>
      <span className="w-24 shrink-0 text-right font-[family-name:var(--admin-mono)] text-[11px] text-[#666]">
        {presale}
      </span>
      <span className="w-20 shrink-0 text-right">
        {page.status === "live" ? (
          <Link
            href={`/l/${clientSlug}/${page.eventSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-[family-name:var(--admin-mono)] text-[11px] text-[#666] underline hover:text-black"
          >
            view
          </Link>
        ) : (
          <span className="font-[family-name:var(--admin-mono)] text-[11px] text-[#999]">
            —
          </span>
        )}
      </span>
    </div>
  );
}
