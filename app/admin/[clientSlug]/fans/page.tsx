import Link from "next/link";
import { Download } from "lucide-react";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { softDeleteFanSignup } from "@/lib/actions/fan-signups";
import {
  fanFiltersToQueryString,
  parseFanFilters,
  type FanFilters,
} from "@/lib/admin/fans-query";
import {
  getFanFilterOptions,
  listFanSignups,
  type FanRow,
} from "@/lib/db/fan-signups";
import { getClientBranding, listInsightRows } from "@/lib/db/client-admin";
import {
  buildCountryBreakdown,
  buildDailySeries,
  computeMetrics,
} from "@/lib/admin/insights";
import { formatCountry } from "@/lib/admin/country-names";
import { AdminLinkButton } from "@/components/admin/ui/button";
import {
  MetricGrid,
  MetricStat,
  Section,
} from "@/components/admin/ui/section";
import { FanGrowthChart, TopLocations } from "@/components/admin/fans-analytics";
import {
  AdminStatusPill,
  AdminTable,
  AdminTd,
  AdminTh,
  AdminTr,
} from "@/components/admin/ui/table";

const RANGE_OPTIONS = [7, 30, 90] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

function parseRange(raw: string | string[] | undefined): RangeDays {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  return (RANGE_OPTIONS as readonly number[]).includes(n)
    ? (n as RangeDays)
    : 30;
}

/**
 * app/admin/[clientSlug]/fans/page.tsx — fan data table (OP909 Phase 5,
 * Supreme aesthetic in Sprint 1 Goal 8). Filters travel in the query string
 * (shareable, refresh-safe); the filter bar is a plain GET form so the whole
 * page stays a server component. Decrypted PII renders server-side only —
 * nothing sensitive crosses into client-component props. Table chrome comes
 * from the shared admin Table primitive (hairline rows, mono cells).
 */
export default async function FansPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const rawSearchParams = await searchParams;
  const filters = parseFanFilters(rawSearchParams);
  const rangeDays = parseRange(rawSearchParams.range);

  const [{ rows, total, perPage }, options, branding, insightRows] =
    await Promise.all([
      listFanSignups(membership.clientId, filters),
      getFanFilterOptions(membership.clientId),
      getClientBranding(membership.clientId, membership.clientName),
      // Analytics band reflects the selected Page filter (if any); the row-level
      // filters (country/consent/date/search) only scope the table below.
      listInsightRows(membership.clientId, filters.eventId),
    ]);

  const now = new Date();
  const metrics = computeMetrics(insightRows, now);
  const series = buildDailySeries(insightRows, now, rangeDays);
  const topLocations = buildCountryBreakdown(insightRows, 6);
  const accent = branding.accent;

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const base = `/admin/${membership.clientSlug}/fans`;
  const hasFilters =
    filters.eventId !== null ||
    filters.country !== null ||
    filters.consent !== "all" ||
    filters.from !== null ||
    filters.to !== null ||
    filters.search !== null;

  const labelCls =
    "mb-1 block font-[family-name:var(--admin-mono)] text-[10px] uppercase tracking-[1.5px] text-[#666]";

  return (
    <div className="mx-auto max-w-7xl px-8 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="admin-heading text-[28px] leading-none">Fans</h1>
          <p className="mt-2 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
            {total.toLocaleString("en-GB")} signup{total === 1 ? "" : "s"}
            {hasFilters ? " matching your filters" : ""}.
          </p>
        </div>
        <AdminLinkButton
          href={`${base}/export${fanFiltersToQueryString(filters, { page: 1 })}`}
          accentFill={accent}
        >
          <Download className="h-3.5 w-3.5" />
          export csv
        </AdminLinkButton>
      </div>

      {/* ── Analytics band (reflects the selected Page filter) ────────── */}
      <div className="mt-8">
        <MetricGrid>
          <MetricStat
            label="Total signups"
            value={metrics.total.toLocaleString("en-GB")}
            accent={accent}
          />
          <MetricStat label="Today" value={metrics.today} accent={accent} />
          <MetricStat
            label="Last 7 days"
            value={metrics.last7Days}
            accent={accent}
          />
          <MetricStat
            label="WhatsApp opt-in"
            value={
              metrics.waOptInRatePct === null
                ? "—"
                : `${metrics.waOptInRatePct}%`
            }
            accent={accent}
          />
        </MetricGrid>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[3fr_2fr]">
        <Section
          title="Fan growth"
          action={
            <div className="flex items-center gap-1 font-[family-name:var(--admin-mono)] text-[11px]">
              {RANGE_OPTIONS.map((days) => {
                const active = days === rangeDays;
                const qs = fanFiltersToQueryString(filters, { page: 1 });
                const href = `${base}${qs}${qs ? "&" : "?"}range=${days}`;
                return (
                  <Link
                    key={days}
                    href={href}
                    className={
                      active
                        ? "px-2 py-0.5 text-black underline"
                        : "px-2 py-0.5 text-[#999] hover:text-black"
                    }
                  >
                    {days}d
                  </Link>
                );
              })}
            </div>
          }
        >
          {metrics.total === 0 ? (
            <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#999]">
              No signups yet.
            </p>
          ) : (
            <FanGrowthChart series={series} accent={accent} />
          )}
        </Section>

        <Section title="Top locations">
          <TopLocations slices={topLocations} accent={accent} />
        </Section>
      </div>

      {/* ── Filter bar (GET form — server-rendered, no client JS) ────── */}
      <form
        method="get"
        className="mt-8 grid grid-cols-2 gap-3 border-[0.5px] border-black p-4 md:grid-cols-3 lg:grid-cols-6"
      >
        <label className="block">
          <span className={labelCls}>Page</span>
          <select name="event" defaultValue={filters.eventId ?? ""} className="h-9 w-full text-[12px]">
            <option value="">All pages</option>
            {options.events.map((event) => (
              <option key={event.eventId} value={event.eventId}>
                {event.eventName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Country</span>
          <select name="country" defaultValue={filters.country ?? ""} className="h-9 w-full text-[12px]">
            <option value="">All countries</option>
            {options.countries.map((country) => (
              <option key={country} value={country}>
                {formatCountry(country)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>WhatsApp opt-in</span>
          <select name="consent" defaultValue={filters.consent} className="h-9 w-full text-[12px]">
            <option value="all">All</option>
            <option value="wa-opted-in">Opted in</option>
            <option value="no-wa">Not opted in</option>
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>From</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className="h-9 w-full text-[12px]" />
        </label>
        <label className="block">
          <span className={labelCls}>To</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className="h-9 w-full text-[12px]" />
        </label>
        <label className="block">
          <span className={labelCls}>Search</span>
          <input
            type="text"
            name="q"
            defaultValue={filters.search ?? ""}
            placeholder="email or @handle"
            className="h-9 w-full text-[12px]"
          />
        </label>
        <div className="col-span-2 flex items-end gap-4 md:col-span-3 lg:col-span-6">
          <button
            type="submit"
            className="h-9 border-[0.5px] border-black px-4 font-[family-name:var(--admin-mono)] text-[12px] lowercase tracking-[0.02em] hover:bg-[#f5f5f5]"
          >
            apply filters
          </button>
          {hasFilters && (
            <Link
              href={base}
              className="font-[family-name:var(--admin-mono)] text-[11px] text-[#666] underline hover:text-black"
            >
              clear all
            </Link>
          )}
          <p className="ml-auto font-[family-name:var(--admin-mono)] text-[10px] text-[#999]">
            Email search is exact-match; handle search matches partially. Phone
            search isn&apos;t supported (numbers are stored encrypted).
          </p>
        </div>
      </form>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="mt-8 border-[0.5px] border-black px-6 py-16 text-center">
          <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
            {hasFilters
              ? "No signups match these filters."
              : "No signups yet — they'll appear here as fans register on your landing pages."}
          </p>
        </div>
      ) : (
        <div className="mt-8">
          <AdminTable>
            <thead>
              <AdminTr>
                <AdminTh>Email</AdminTh>
                <AdminTh>Phone</AdminTh>
                <AdminTh>Social</AdminTh>
                <AdminTh>Country</AdminTh>
                <AdminTh>WA opt-in</AdminTh>
                <AdminTh>Signed up</AdminTh>
                <AdminTh>Page</AdminTh>
                <AdminTh align="right">Actions</AdminTh>
              </AdminTr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FanTableRow key={row.id} row={row} filters={filters} base={base} />
              ))}
            </tbody>
          </AdminTable>
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between font-[family-name:var(--admin-mono)] text-[11px] text-[#666]">
          <p>
            Page {filters.page} of {totalPages}
          </p>
          <div className="flex items-center gap-3">
            {filters.page > 1 && (
              <Link
                href={`${base}${fanFiltersToQueryString(filters, { page: filters.page - 1 })}`}
                className="px-2 py-1 hover:text-black"
              >
                prev
              </Link>
            )}
            {filters.page < totalPages && (
              <Link
                href={`${base}${fanFiltersToQueryString(filters, { page: filters.page + 1 })}`}
                className="px-2 py-1 hover:text-black"
              >
                next
              </Link>
            )}
          </div>
        </div>
      )}
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

function absoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}

function FanTableRow({
  row,
  filters,
  base,
}: {
  row: FanRow;
  filters: FanFilters;
  base: string;
}) {
  const social = row.igHandle
    ? { label: `@${row.igHandle}`, kind: "IG" }
    : row.ttHandle
      ? { label: `@${row.ttHandle}`, kind: "TT" }
      : null;
  return (
    <AdminTr>
      <AdminTd className="text-black">{row.email ?? "—"}</AdminTd>
      <AdminTd className="tabular-nums">{row.phone ?? "—"}</AdminTd>
      <AdminTd className="text-[#666]">
        {social ? (
          <span>
            {social.label}{" "}
            <span className="text-[10px] uppercase text-[#999]">
              {social.kind}
            </span>
          </span>
        ) : (
          "—"
        )}
      </AdminTd>
      <AdminTd>{formatCountry(row.country)}</AdminTd>
      <AdminTd>
        {row.waOptInAt ? (
          <AdminStatusPill tone="positive">yes</AdminStatusPill>
        ) : (
          <span className="text-[10px] uppercase tracking-[0.5px] text-[#999]">no</span>
        )}
      </AdminTd>
      <AdminTd className="text-[#666]" title={absoluteTime(row.createdAt)}>
        {relativeTime(row.createdAt)}
      </AdminTd>
      <AdminTd>
        <Link
          href={`${base}${fanFiltersToQueryString(filters, { eventId: row.eventId, page: 1 })}`}
          className="text-[#666] underline hover:text-black"
        >
          {row.eventName}
        </Link>
      </AdminTd>
      <AdminTd align="right">
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`${base}/${row.id}`}
            className="text-[#666] underline hover:text-black"
          >
            view
          </Link>
          <form action={softDeleteFanSignup} className="flex">
            <input type="hidden" name="signup_id" value={row.id} />
            <button
              type="submit"
              className="text-[#666] underline hover:text-[#d33]"
            >
              delete
            </button>
          </form>
        </div>
      </AdminTd>
    </AdminTr>
  );
}
