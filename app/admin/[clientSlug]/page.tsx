import Link from "next/link";

import { requireClientContext } from "@/lib/auth/get-client-context";
import {
  countClientSignups,
  listClientPages,
  type ClientPageSummary,
} from "@/lib/db/client-admin";

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
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-heading text-2xl tracking-wide">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your landing pages and fan signups at a glance.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Landing pages" value={String(pages.length)} />
        <MetricCard label="Live pages" value={String(livePages)} />
        <MetricCard label="Total fan signups" value={String(totalSignups)} />
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Landing pages
          </h2>
        </div>

        {pages.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No landing pages yet. Page management arrives in the Pages tab.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Event</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Signups</th>
                  <th className="px-4 py-2.5 font-medium">Presale</th>
                  <th className="px-4 py-2.5 font-medium">Page</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <PageRow
                    key={page.pageEventId}
                    page={page}
                    clientSlug={membership.clientSlug}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-heading text-3xl tracking-wide">{value}</p>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  live: "bg-green-100 text-green-800",
  draft: "bg-amber-100 text-amber-800",
  archived: "bg-gray-100 text-gray-600",
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
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3 font-medium">{page.eventName}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_STYLES[page.status] ?? STATUS_STYLES.draft
          }`}
        >
          {page.status}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{page.signupCount}</td>
      <td className="px-4 py-3 text-muted-foreground">{presale}</td>
      <td className="px-4 py-3">
        {page.status === "live" ? (
          <Link
            href={`/l/${clientSlug}/${page.eventSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            View live
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}
