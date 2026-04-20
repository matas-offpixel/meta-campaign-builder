"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  RefreshCw,
} from "lucide-react";

import type {
  OverviewFilter,
  OverviewPhaseMarker,
  OverviewRow,
  OverviewSpendResponse,
  PhasePillColor,
} from "@/lib/types/overview";

interface Props {
  initialRows: OverviewRow[];
  initialFilter: OverviewFilter;
}

type SortKey =
  | "event_date"
  | "name"
  | "event_code"
  | "capacity"
  | "tickets_sold"
  | "budget_marketing"
  | "spend_total"
  | "spend_yesterday"
  | "days_until"
  | "budget_left"
  | "left_per_day";

type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Default sort = event_date asc for future, desc for past. Matches
 * the server fetch order so a fresh page load doesn't visibly reshuffle.
 */
function defaultSort(filter: OverviewFilter): SortState {
  return {
    key: "event_date",
    dir: filter === "future" ? "asc" : "desc",
  };
}

const SORTABLE_KEYS = new Set<SortKey>([
  "event_date",
  "name",
  "event_code",
  "capacity",
  "tickets_sold",
  "budget_marketing",
  "spend_total",
  "spend_yesterday",
  "days_until",
  "budget_left",
  "left_per_day",
]);

function parseSort(
  raw: string | null,
  filter: OverviewFilter,
): SortState {
  if (!raw) return defaultSort(filter);
  const candidate = raw as SortKey;
  return SORTABLE_KEYS.has(candidate)
    ? { key: candidate, dir: defaultSort(filter).dir }
    : defaultSort(filter);
}

/**
 * Lazy spend payload merge — keep the original row order; just patch
 * the four spend columns on the matching event id.
 */
function mergeSpend(
  rows: OverviewRow[],
  stats: OverviewSpendResponse,
): OverviewRow[] {
  return rows.map((row) => {
    const next = stats[row.event_id];
    if (!next) return row;
    const spendTotal = next.spend_total;
    const budgetLeft =
      row.budget_marketing !== null && spendTotal !== null
        ? Math.max(0, row.budget_marketing - spendTotal)
        : null;
    const leftPerDay =
      budgetLeft !== null && row.days_until !== null && row.days_until > 0
        ? budgetLeft / row.days_until
        : null;
    return {
      ...row,
      spend_total: spendTotal,
      spend_yesterday: next.spend_yesterday,
      budget_left: budgetLeft,
      left_per_day: leftPerDay,
    };
  });
}

export function OverviewTable({ initialRows, initialFilter }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const urlSort = sp?.get("sort") ?? null;
  const urlDir = (sp?.get("dir") ?? null) as SortDir | null;

  const [rows, setRows] = useState<OverviewRow[]>(initialRows);
  const [sort, setSort] = useState<SortState>(() => {
    const base = parseSort(urlSort, initialFilter);
    if (urlDir === "asc" || urlDir === "desc") {
      return { ...base, dir: urlDir };
    }
    return base;
  });
  const [statsState, setStatsState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [statsError, setStatsError] = useState<string | null>(null);
  const [, startNavTransition] = useTransition();

  // Re-sync local state when the server hands a new initialRows after a
  // future/past flip. The server page re-renders so this just refreshes
  // the cached row list — sort survives because we drive it from URL.
  useEffect(() => {
    setRows(initialRows);
    setStatsState("idle");
    setStatsError(null);
  }, [initialRows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => compareRows(a, b, sort));
  }, [rows, sort]);

  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key === key) {
        const nextDir: SortDir = prev.dir === "asc" ? "desc" : "asc";
        const next = { key, dir: nextDir };
        pushSortToUrl(router, sp, next);
        return next;
      }
      const next: SortState = { key, dir: defaultSortDirForKey(key) };
      pushSortToUrl(router, sp, next);
      return next;
    });
  };

  const handleFilter = (filter: OverviewFilter) => {
    if (filter === initialFilter) return;
    const next = new URLSearchParams(sp?.toString() ?? "");
    next.set("filter", filter);
    next.delete("sort");
    next.delete("dir");
    startNavTransition(() => {
      router.push(`?${next.toString()}`);
    });
  };

  const loadableEventIds = useMemo(
    () =>
      rows
        .filter((r) => Boolean(r.meta_ad_account_id))
        .map((r) => r.event_id)
        .slice(0, 20),
    [rows],
  );

  const handleLoadStats = async () => {
    if (loadableEventIds.length === 0) {
      setStatsState("loaded");
      return;
    }
    setStatsState("loading");
    setStatsError(null);
    try {
      const qs = new URLSearchParams({
        eventIds: loadableEventIds.join(","),
      });
      const res = await fetch(`/api/overview/stats?${qs.toString()}`);
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        stats?: OverviewSpendResponse;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.stats) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setRows((prev) => mergeSpend(prev, json.stats!));
      setStatsState("loaded");
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Failed");
      setStatsState("error");
    }
  };

  const eventCount = rows.length;
  const futureActive = initialFilter === "future";
  const emptyCopy = futureActive
    ? "No upcoming events. Add an event to get started."
    : "No past events yet.";

  return (
    <section className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => handleFilter("future")}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                futureActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Future
            </button>
            <button
              type="button"
              onClick={() => handleFilter("past")}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                !futureActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Past
            </button>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {eventCount} event{eventCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {statsError && (
            <span className="text-[11px] text-destructive">
              {statsError}
            </span>
          )}
          <button
            type="button"
            onClick={handleLoadStats}
            disabled={statsState === "loading" || rows.length === 0}
            title="Fetches live Meta spend for all events"
            className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {statsState === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : statsState === "loaded" ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {statsState === "loading"
              ? "Loading…"
              : statsState === "loaded"
                ? "Stats loaded · Refresh"
                : "Load Stats"}
          </button>
        </div>
      </div>

      {/* Table */}
      {sortedRows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">{emptyCopy}</p>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr className="text-left">
                <Th
                  sortKey="event_date"
                  sort={sort}
                  onSort={handleSort}
                  className="sticky left-0 z-20 bg-muted/40 w-[88px]"
                >
                  Date
                </Th>
                <Th
                  sortKey="name"
                  sort={sort}
                  onSort={handleSort}
                  className="sticky left-[88px] z-20 bg-muted/40 min-w-[260px]"
                >
                  Title
                </Th>
                <Th sortKey="event_code" sort={sort} onSort={handleSort}>
                  Code
                </Th>
                <Th
                  sortKey="capacity"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                >
                  Capacity
                </Th>
                <Th
                  sortKey="tickets_sold"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                >
                  Tickets sold
                </Th>
                <Th
                  sortKey="budget_marketing"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                >
                  Budget
                </Th>
                <Th
                  sortKey="spend_total"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                >
                  Spend
                </Th>
                <Th
                  sortKey="spend_yesterday"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                >
                  Spend yday
                </Th>
                <Th
                  sortKey="days_until"
                  sort={sort}
                  onSort={handleSort}
                  align="center"
                >
                  Days until
                </Th>
                <Th
                  sortKey="budget_left"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                >
                  Budget left
                </Th>
                <Th
                  sortKey="left_per_day"
                  sort={sort}
                  onSort={handleSort}
                  align="right"
                >
                  Left/day
                </Th>
                <th className="px-3 py-2 font-medium">Next phase</th>
                <th className="px-3 py-2 font-medium">Next activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRows.map((row) => (
                <OverviewRowView key={row.event_id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Row component ────────────────────────────────────────────────

function OverviewRowView({ row }: { row: OverviewRow }) {
  return (
    <tr className="bg-card hover:bg-muted/40 transition-colors">
      <td className="sticky left-0 z-10 bg-card px-3 py-3 align-top w-[88px] whitespace-nowrap">
        <span className="font-mono text-[11px] text-foreground">
          {formatDate(row.event_date)}
        </span>
      </td>
      <td className="sticky left-[88px] z-10 bg-card px-3 py-3 align-top min-w-[260px]">
        <Link
          href={`/events/${row.event_id}`}
          className="block group"
        >
          <p className="font-medium text-sm text-foreground group-hover:underline truncate">
            {row.name}
          </p>
          {(row.venue_name || row.venue_city) && (
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {[row.venue_name, row.venue_city].filter(Boolean).join(" · ")}
            </p>
          )}
          {row.client && (
            <ClientBadge
              name={row.client.name}
              primaryType={row.client.primary_type}
            />
          )}
        </Link>
      </td>
      <td className="px-3 py-3 align-top font-mono text-[11px] text-muted-foreground">
        {row.event_code ?? "—"}
      </td>
      <td className="px-3 py-3 align-top text-right tabular-nums">
        {row.capacity !== null ? formatNumber(row.capacity) : "—"}
      </td>
      <td className="px-3 py-3 align-top text-right tabular-nums">
        <TicketsSold
          sold={row.tickets_sold}
          capacity={row.capacity}
        />
      </td>
      <td className="px-3 py-3 align-top text-right tabular-nums">
        {row.budget_marketing !== null
          ? formatCurrency(row.budget_marketing)
          : "—"}
      </td>
      <td className="px-3 py-3 align-top text-right tabular-nums">
        {row.spend_total !== null ? formatCurrency(row.spend_total) : "—"}
      </td>
      <td className="px-3 py-3 align-top text-right tabular-nums">
        {row.spend_yesterday !== null
          ? formatCurrency(row.spend_yesterday)
          : "—"}
      </td>
      <td className="px-3 py-3 align-top text-center">
        <DaysUntilPill days={row.days_until} />
      </td>
      <td className="px-3 py-3 align-top text-right tabular-nums">
        {row.budget_left !== null ? formatCurrency(row.budget_left) : "—"}
      </td>
      <td className="px-3 py-3 align-top text-right tabular-nums">
        {row.left_per_day !== null
          ? `${formatCurrency(row.left_per_day)}/day`
          : "—"}
      </td>
      <td className="px-3 py-3 align-top">
        <PhasePill phase={row.next_phase} />
      </td>
      <td className="px-3 py-3 align-top">
        {row.next_activity ? (
          <div className="space-y-0.5">
            <p className="text-xs text-foreground truncate max-w-[220px]">
              {row.next_activity.description}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {formatDate(row.next_activity.date)}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Cell helpers ─────────────────────────────────────────────────

function Th({
  sortKey,
  sort,
  onSort,
  children,
  className = "",
  align = "left",
}: {
  sortKey: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  const justify =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-medium ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${justify}`}
      >
        {children}
        <Icon
          className={`h-3 w-3 ${active ? "opacity-100" : "opacity-30"}`}
        />
      </button>
    </th>
  );
}

function ClientBadge({
  name,
  primaryType,
}: {
  name: string;
  primaryType: string | null;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
  const palette = clientPalette(primaryType);
  return (
    <div className="mt-1.5 inline-flex items-center gap-1.5">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold ${palette.bg} ${palette.text}`}
      >
        {initials}
      </span>
      <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">
        {name}
      </span>
    </div>
  );
}

function clientPalette(primaryType: string | null): {
  bg: string;
  text: string;
} {
  switch (primaryType) {
    case "promoter":
      return { bg: "bg-indigo-100", text: "text-indigo-700" };
    case "festival":
      return { bg: "bg-emerald-100", text: "text-emerald-700" };
    case "brand":
      return { bg: "bg-amber-100", text: "text-amber-700" };
    default:
      return { bg: "bg-zinc-200", text: "text-zinc-700" };
  }
}

function DaysUntilPill({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">—</span>;
  if (days === 0) {
    return <Pill className="bg-red-100 text-red-700">Today</Pill>;
  }
  if (days < 0) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {Math.abs(days)}d ago
      </span>
    );
  }
  if (days <= 6) {
    return <Pill className="bg-orange-100 text-orange-700">{days}d</Pill>;
  }
  if (days <= 29) {
    return <Pill className="bg-yellow-100 text-yellow-800">{days}d</Pill>;
  }
  if (days <= 59) {
    return <Pill className="bg-zinc-200 text-zinc-700">{days}d</Pill>;
  }
  return (
    <span className="text-[11px] text-muted-foreground">{days}d</span>
  );
}

function PhasePill({ phase }: { phase: OverviewPhaseMarker | null }) {
  if (!phase) {
    return <span className="text-muted-foreground">—</span>;
  }
  const palette = phasePalette(phase.color);
  return (
    <div className="space-y-0.5">
      <Pill className={`${palette.bg} ${palette.text}`}>{phase.name}</Pill>
      <p className="text-[10px] text-muted-foreground">{formatDate(phase.date)}</p>
    </div>
  );
}

function phasePalette(color: PhasePillColor): { bg: string; text: string } {
  switch (color) {
    case "orange":
      return { bg: "bg-orange-100", text: "text-orange-700" };
    case "green":
      return { bg: "bg-emerald-100", text: "text-emerald-700" };
    case "blue":
      return { bg: "bg-sky-100", text: "text-sky-700" };
    case "purple":
      return { bg: "bg-violet-100", text: "text-violet-700" };
    default:
      return { bg: "bg-zinc-200", text: "text-zinc-700" };
  }
}

function Pill({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function TicketsSold({
  sold,
  capacity,
}: {
  sold: number | null;
  capacity: number | null;
}) {
  if (sold === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const cap = capacity ?? 0;
  const ratio = cap > 0 ? sold / cap : 0;
  let toneClass = "text-foreground";
  if (cap > 0 && sold >= cap) {
    toneClass = "text-emerald-600 font-semibold";
  } else if (cap > 0 && ratio >= 0.85) {
    toneClass = "text-orange-600 font-semibold";
  }
  return (
    <span className={toneClass}>
      {formatNumber(sold)}
      {cap > 0 && (
        <span className="text-muted-foreground"> / {formatNumber(cap)}</span>
      )}
    </span>
  );
}

// ─── Pure helpers ─────────────────────────────────────────────────

function pushSortToUrl(
  router: ReturnType<typeof useRouter>,
  sp: ReturnType<typeof useSearchParams>,
  next: SortState,
) {
  const params = new URLSearchParams(sp?.toString() ?? "");
  params.set("sort", next.key);
  params.set("dir", next.dir);
  router.replace(`?${params.toString()}`, { scroll: false });
}

function defaultSortDirForKey(key: SortKey): SortDir {
  // Numeric / date columns feel more useful descending on first click
  // (see the biggest budget / latest event first); textual columns
  // start ascending (alphabetical).
  if (key === "name" || key === "event_code" || key === "event_date") {
    return key === "event_date" ? "desc" : "asc";
  }
  return "desc";
}

function compareRows(a: OverviewRow, b: OverviewRow, sort: SortState): number {
  const dir = sort.dir === "asc" ? 1 : -1;
  const av = readSortValue(a, sort.key);
  const bv = readSortValue(b, sort.key);

  // Nulls sink to the bottom regardless of direction.
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;

  if (typeof av === "number" && typeof bv === "number") {
    return (av - bv) * dir;
  }
  return String(av).localeCompare(String(bv)) * dir;
}

function readSortValue(row: OverviewRow, key: SortKey): number | string | null {
  switch (key) {
    case "event_date":
      return row.event_date;
    case "name":
      return row.name.toLowerCase();
    case "event_code":
      return row.event_code ? row.event_code.toLowerCase() : null;
    case "capacity":
      return row.capacity;
    case "tickets_sold":
      return row.tickets_sold;
    case "budget_marketing":
      return row.budget_marketing;
    case "spend_total":
      return row.spend_total;
    case "spend_yesterday":
      return row.spend_yesterday;
    case "days_until":
      return row.days_until;
    case "budget_left":
      return row.budget_left;
    case "left_per_day":
      return row.left_per_day;
    default:
      return null;
  }
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

function formatCurrency(n: number): string {
  // £ with no decimals — the table is dense; pence are noise here.
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso: string | null): string {
  if (!iso) return "TBC";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(d);
}
