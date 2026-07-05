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

/**
 * app/admin/[clientSlug]/fans/page.tsx — fan data table (OP909 Phase 5).
 * Filters travel in the query string (shareable, refresh-safe); the
 * filter bar is a plain GET form so the whole page stays a server
 * component. Decrypted PII renders server-side only — nothing sensitive
 * crosses into client-component props.
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
  const filters = parseFanFilters(await searchParams);

  const [{ rows, total, perPage }, options] = await Promise.all([
    listFanSignups(membership.clientId, filters),
    getFanFilterOptions(membership.clientId),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const base = `/admin/${membership.clientSlug}/fans`;
  const hasFilters =
    filters.eventId !== null ||
    filters.country !== null ||
    filters.consent !== "all" ||
    filters.from !== null ||
    filters.to !== null ||
    filters.search !== null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl tracking-wide">Fans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString("en-GB")} signup{total === 1 ? "" : "s"}
            {hasFilters ? " matching your filters" : ""}.
          </p>
        </div>
        <a
          href={`${base}/export${fanFiltersToQueryString(filters, { page: 1 })}`}
          className="flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </a>
      </div>

      {/* ── Filter bar (GET form — server-rendered, no client JS) ────── */}
      <form
        method="get"
        className="mt-6 grid grid-cols-2 gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-3 lg:grid-cols-6"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Page
          </span>
          <select
            name="event"
            defaultValue={filters.eventId ?? ""}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All pages</option>
            {options.events.map((event) => (
              <option key={event.eventId} value={event.eventId}>
                {event.eventName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Country
          </span>
          <select
            name="country"
            defaultValue={filters.country ?? ""}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All countries</option>
            {options.countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            WhatsApp opt-in
          </span>
          <select
            name="consent"
            defaultValue={filters.consent}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All</option>
            <option value="wa-opted-in">Opted in</option>
            <option value="no-wa">Not opted in</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            From
          </span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ""}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            To
          </span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ""}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Search
          </span>
          <input
            type="text"
            name="q"
            defaultValue={filters.search ?? ""}
            placeholder="email or @handle"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <div className="col-span-2 flex items-end gap-3 md:col-span-3 lg:col-span-6">
          <button
            type="submit"
            className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            Apply filters
          </button>
          {hasFilters && (
            <Link
              href={base}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear all
            </Link>
          )}
          <p className="ml-auto text-xs text-muted-foreground">
            Email search is exact-match; handle search matches partially.
            Phone search isn&apos;t supported (numbers are stored encrypted).
          </p>
        </div>
      </form>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            {hasFilters
              ? "No signups match these filters."
              : "No signups yet — they'll appear here as fans register on your landing pages."}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Phone</th>
                <th className="px-4 py-2.5 font-medium">Social</th>
                <th className="px-4 py-2.5 font-medium">Country</th>
                <th className="px-4 py-2.5 font-medium">WA opt-in</th>
                <th className="px-4 py-2.5 font-medium">Signed up</th>
                <th className="px-4 py-2.5 font-medium">Page</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FanTableRow key={row.id} row={row} filters={filters} base={base} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Page {filters.page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {filters.page > 1 && (
              <Link
                href={`${base}${fanFiltersToQueryString(filters, { page: filters.page - 1 })}`}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
              >
                Previous
              </Link>
            )}
            {filters.page < totalPages && (
              <Link
                href={`${base}${fanFiltersToQueryString(filters, { page: filters.page + 1 })}`}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-muted"
              >
                Next
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
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3 font-medium">{row.email ?? "—"}</td>
      <td className="px-4 py-3 tabular-nums">{row.phone ?? "—"}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {social ? (
          <span>
            {social.label}{" "}
            <span className="text-xs uppercase text-muted-foreground/70">
              {social.kind}
            </span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3">{row.country ?? "—"}</td>
      <td className="px-4 py-3">
        {row.waOptInAt ? (
          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            yes
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">no</span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground" title={absoluteTime(row.createdAt)}>
        {relativeTime(row.createdAt)}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`${base}${fanFiltersToQueryString(filters, { eventId: row.eventId, page: 1 })}`}
          className="text-xs underline text-muted-foreground hover:text-foreground"
        >
          {row.eventName}
        </Link>
      </td>
      <td className="px-4 py-3">
        <form action={softDeleteFanSignup} className="flex justify-end">
          <input type="hidden" name="signup_id" value={row.id} />
          <button
            type="submit"
            className="text-xs underline text-destructive/80 hover:text-destructive"
          >
            Delete
          </button>
        </form>
      </td>
    </tr>
  );
}
