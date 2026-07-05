import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { requireClientContext } from "@/lib/auth/get-client-context";
import {
  countClientSignups,
  getClientBranding,
  getPixelHealth,
  listClientPages,
  listRecentSignups,
  type ClientPageSummary,
} from "@/lib/db/client-admin";
import { nextPresale, pixelWarning } from "@/lib/admin/dashboard-widgets";
import { formatCountry } from "@/lib/admin/country-names";
import { MetricGrid, MetricStat, Section } from "@/components/admin/ui/section";
import { NextPresaleCountdown } from "@/components/admin/next-presale-countdown";

/**
 * app/admin/[clientSlug]/page.tsx — client dashboard home (OP909 Phase 1 +
 * Sprint 2 PR 7). Overview plus three widgets: a pixel-health banner
 * (config-completeness warning on live pages), the next-presale countdown,
 * and a recent-signups feed.
 */
export default async function ClientDashboardHome({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);

  const [pages, totalSignups, pixel, recent, branding] = await Promise.all([
    listClientPages(membership.clientId),
    countClientSignups(membership.clientId),
    getPixelHealth(membership.clientId),
    listRecentSignups(membership.clientId, 10),
    getClientBranding(membership.clientId, membership.clientName),
  ]);
  const livePages = pages.filter((p) => p.status === "live").length;
  const warning = pixelWarning({
    livePages,
    pixelId: pixel?.pixelId ?? null,
    capiTokenConfigured: pixel?.capiTokenConfigured ?? false,
  });
  const presale = resolveNextPresale(pages);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="admin-heading text-[28px] leading-none">Dashboard</h1>
      <p className="mt-2 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
        Your landing pages and fan signups at a glance.
      </p>

      {warning && (
        <div
          className={`mt-6 flex items-start gap-3 border-[0.5px] p-4 ${
            warning.level === "error"
              ? "border-[#d33] bg-[#fdecea]"
              : "border-[#8d6e00] bg-[#fff8e1]"
          }`}
        >
          <AlertTriangle
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              warning.level === "error" ? "text-[#d33]" : "text-[#8d6e00]"
            }`}
          />
          <p className="font-[family-name:var(--admin-mono)] text-[12px] leading-relaxed text-black">
            {warning.message}{" "}
            <Link
              href={`/admin/${membership.clientSlug}/integrations/meta-pixel`}
              className="underline hover:opacity-70"
            >
              Fix now
            </Link>
          </p>
        </div>
      )}

      <div className="mt-8">
        <MetricGrid>
          <MetricStat label="Landing pages" value={pages.length} accent={branding.accent} />
          <MetricStat label="Live pages" value={livePages} accent={branding.accent} />
          <MetricStat label="Total fan signups" value={totalSignups} accent={branding.accent} />
        </MetricGrid>
      </div>

      {presale && (
        <Section title="Next presale">
          <NextPresaleCountdown
            targetAt={presale.presaleAt}
            eventName={presale.eventName}
            accent={branding.accent}
          />
        </Section>
      )}

      <Section title="Recent signups">
        {recent.length === 0 ? (
          <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
            No signups yet — they&apos;ll appear here as fans register on your
            landing pages.
          </p>
        ) : (
          <ul>
            {recent.map((signup, i) => (
              <li
                key={`${signup.createdAt}-${i}`}
                className="flex items-baseline gap-4 border-b-[0.5px] border-[#eee] py-2.5 font-[family-name:var(--admin-mono)] text-[12px] last:border-b-0"
              >
                <span className="w-36 shrink-0 text-[#666]">
                  {relativeTime(signup.createdAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-black">
                  {signup.eventName}
                </span>
                <span className="shrink-0 text-[#666]">
                  {signup.country ? formatCountry(signup.country) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

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

/** Wraps the Date.now() read so it isn't a direct impure call in render. */
function resolveNextPresale(pages: ClientPageSummary[]) {
  return nextPresale(pages, Date.now());
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

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
