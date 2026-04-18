"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Calendar as CalendarIcon,
  List,
  Search,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { MilestoneChip } from "@/components/dashboard/_shared/milestone-chip";
import { DayPopover } from "@/components/dashboard/_shared/day-popover";
import { createClient as createSupabase } from "@/lib/supabase/client";
import {
  listEvents,
  listDraftsForUserByEvent,
  type EventWithClient,
} from "@/lib/db/events";
import {
  daysBetween,
  fmtMonthParam,
  midnightOf,
  parseCalendarView,
  parseDateOnly,
  parseMilestoneKinds,
  parseMonth,
  parseTs,
  MILESTONE_KINDS,
  MILESTONE_LABEL,
  MILESTONE_COLOR,
  type CalendarView as CalendarViewName,
  type MilestoneKind,
} from "@/lib/dashboard/format";

// ─── Calendar-grid date helpers ──────────────────────────────────────────────
// Kept local — these are calendar-grid concerns (month boundaries, ISO
// week-numbering, yyyy-mm-dd keys for grouping) and aren't reused elsewhere.

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function toYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Heatmap palette ─────────────────────────────────────────────────────────
//
// Each bucket is a literal string so Tailwind's content scanner picks up
// every utility — never build the tint className from computed numbers.
// `bg-card` is repeated in each entry so tinted cells keep a solid surface
// (the grid wrapper is `bg-border`; losing bg-card would let the divider
// colour bleed through). The arbitrary-value `bg-foreground/[X]` is emitted
// after the static `bg-card` utility in Tailwind v4, so cascade order
// resolves to the tint without needing `!`.

const HEATMAP_BG_CLASSES = [
  "bg-card",
  "bg-card bg-foreground/[0.03]",
  "bg-card bg-foreground/[0.06]",
  "bg-card bg-foreground/[0.10]",
  "bg-card bg-foreground/[0.15]",
] as const;

function heatmapTintClass(count: number): string {
  if (count <= 0) return HEATMAP_BG_CLASSES[0];
  if (count === 1) return HEATMAP_BG_CLASSES[1];
  if (count <= 3) return HEATMAP_BG_CLASSES[2];
  if (count <= 5) return HEATMAP_BG_CLASSES[3];
  return HEATMAP_BG_CLASSES[4];
}

// ─── Milestone markers ───────────────────────────────────────────────────────

type MilestoneHit = {
  kind: MilestoneKind;
  date: Date;
  event: EventWithClient;
};

/**
 * Flatten all milestone dates across events. One event yields up to 4 hits
 * (announcement, presale, general-sale, event).
 */
function expandMilestones(events: EventWithClient[]): MilestoneHit[] {
  const out: MilestoneHit[] = [];
  for (const e of events) {
    const announcement = parseTs(e.announcement_at);
    const presale = parseTs(e.presale_at);
    const generalSale = parseTs(e.general_sale_at);
    const eventDate =
      parseDateOnly(e.event_date) ?? parseTs(e.event_start_at) ?? null;
    if (announcement) out.push({ kind: "announcement", date: announcement, event: e });
    if (presale) out.push({ kind: "presale", date: presale, event: e });
    if (generalSale) out.push({ kind: "general-sale", date: generalSale, event: e });
    if (eventDate) out.push({ kind: "event", date: eventDate, event: e });
  }
  return out;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CalendarView() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventWithClient[]>([]);
  const [draftByEvent, setDraftByEvent] = useState<
    Map<string, { id: string; updated_at: string }>
  >(() => new Map());
  // Stabilised "now" — captured once on mount to keep agenda-chip
  // daysAway math deterministic across renders, AND used as the
  // fallback for `?m=` so the URL parser stays pure.
  const [now] = useState(() => new Date());

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeKinds = useMemo(
    () => parseMilestoneKinds(searchParams.get("kinds") ?? undefined),
    [searchParams],
  );
  const month = useMemo(
    () =>
      parseMonth(searchParams.get("m") ?? undefined) ?? startOfMonth(now),
    [searchParams, now],
  );
  const view = useMemo<CalendarViewName>(
    () => parseCalendarView(searchParams.get("view") ?? undefined),
    [searchParams],
  );
  const query = useMemo(
    () => (searchParams.get("q") ?? "").trim(),
    [searchParams],
  );

  // Mutators preserve every other query param (kinds, etc).
  const writeParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const setMonth = useCallback(
    (next: Date) => {
      const sameAsNowMonth =
        next.getFullYear() === now.getFullYear() &&
        next.getMonth() === now.getMonth();
      writeParams((p) => {
        // Drop ?m= when we're back on the current month so the URL stays
        // clean for the most common case.
        if (sameAsNowMonth) p.delete("m");
        else p.set("m", fmtMonthParam(next));
      });
    },
    [writeParams, now],
  );

  const setView = useCallback(
    (next: CalendarViewName) => {
      writeParams((p) => {
        if (next === "month") p.delete("view");
        else p.set("view", next);
      });
    },
    [writeParams],
  );

  const setQuery = useCallback(
    (next: string) => {
      writeParams((p) => {
        const trimmed = next.trim();
        if (trimmed === "") p.delete("q");
        else p.set("q", trimmed);
      });
    },
    [writeParams],
  );

  useEffect(() => {
    async function load() {
      const supabase = createSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      // Fetch a wide window (past 3 months → next 18 months).
      const from = addMonths(startOfMonth(new Date()), -3);
      const to = addMonths(startOfMonth(new Date()), 18);
      const [rows, drafts] = await Promise.all([
        listEvents(user.id, {
          fromDate: toYmd(from),
          toDate: toYmd(to),
        }),
        listDraftsForUserByEvent(user.id),
      ]);
      setEvents(rows);
      setDraftByEvent(drafts);
      setLoading(false);
    }
    load();
  }, []);

  const milestones = useMemo(() => expandMilestones(events), [events]);

  const filteredMilestones = useMemo(() => {
    let pool = milestones;
    if (activeKinds !== "all") {
      const allowed = new Set(activeKinds);
      pool = pool.filter((m) => allowed.has(m.kind));
    }
    if (query) {
      const needle = query.toLowerCase();
      pool = pool.filter((m) => {
        const name = m.event.name.toLowerCase();
        const client = m.event.client?.name?.toLowerCase() ?? "";
        return name.includes(needle) || client.includes(needle);
      });
    }
    return pool;
  }, [milestones, activeKinds, query]);

  const filtersActive = activeKinds !== "all" || query !== "";

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Event milestones across announcement, presale, general sale and event day."
        actions={
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setView("month")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                view === "month"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              Month
            </button>
            <button
              type="button"
              onClick={() => setView("agenda")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                view === "agenda"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-3.5 w-3.5" />
              Agenda
            </button>
          </div>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FilterStrip active={activeKinds} />
            <SearchInput initialQuery={query} writeQuery={setQuery} />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : view === "month" ? (
            <>
              <MonthView
                month={month}
                milestones={filteredMilestones}
                now={now}
                draftByEvent={draftByEvent}
                onPrev={() => setMonth(addMonths(month, -1))}
                onNext={() => setMonth(addMonths(month, 1))}
                onToday={() => setMonth(startOfMonth(now))}
              />
              {filtersActive && filteredMilestones.length === 0 && (
                <p className="py-3 text-center text-xs text-muted-foreground">
                  No events match these filters.
                </p>
              )}
            </>
          ) : (
            <AgendaView
              milestones={filteredMilestones}
              now={now}
              draftByEvent={draftByEvent}
              filtersActive={filtersActive}
            />
          )}

          <Legend />
        </div>
      </main>
    </>
  );
}

// ─── Filter strip ────────────────────────────────────────────────────────────

function FilterStrip({ active }: { active: MilestoneKind[] | "all" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setKinds = (next: MilestoneKind[] | "all") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("kinds");
    } else {
      params.set("kinds", next.join(","));
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const isAll = active === "all";

  const toggleKind = (k: MilestoneKind) => {
    if (isAll) {
      // Narrowing from "all" — start a fresh selection of just this kind.
      setKinds([k]);
      return;
    }
    if (active.includes(k)) {
      const next = active.filter((x) => x !== k);
      setKinds(next.length === 0 ? "all" : next);
      return;
    }
    const next = [...active, k];
    // Re-collapsed to the full set → normalise back to the clean URL.
    setKinds(next.length === MILESTONE_KINDS.length ? "all" : next);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip selected={isAll} onClick={() => setKinds("all")}>
        All
      </FilterChip>
      {MILESTONE_KINDS.map((k) => {
        const selected = !isAll && active.includes(k);
        return (
          <FilterChip
            key={k}
            selected={selected}
            onClick={() => toggleKind(k)}
            dotClass={MILESTONE_COLOR[k]}
          >
            {MILESTONE_LABEL[k]}
          </FilterChip>
        );
      })}
    </div>
  );
}

// ─── Search input ────────────────────────────────────────────────────────────

/**
 * Debounced text filter for ?q=. Local useState mirrors keystrokes for
 * responsive typing; a useEffect with setTimeout pushes the value to the
 * URL after 250ms of quiet. The push effect is push-only — it does not
 * call setState, so React 19's set-state-in-effect rule is satisfied.
 *
 * IME composition (CJK input) is suppressed: while a composition is in
 * progress, no debounced push is scheduled and any pending push is
 * cancelled. On compositionEnd the debounce restarts with the final value.
 *
 * External URL changes (back button, etc.) intentionally do not retro-
 * actively sync into the local input value — the filter applies regardless
 * because the parent reads from searchParams. This keeps the component
 * lint-clean (no setState-in-effect for URL → local sync) at the cost of
 * one rare-path UX paper-cut.
 */
function SearchInput({
  initialQuery,
  writeQuery,
}: {
  initialQuery: string;
  writeQuery: (next: string) => void;
}) {
  const [value, setValue] = useState(initialQuery);
  const composingRef = useRef(false);
  const lastPushedRef = useRef(initialQuery);

  useEffect(() => {
    if (composingRef.current) return;
    if (value === lastPushedRef.current) return;
    const t = setTimeout(() => {
      lastPushedRef.current = value;
      writeQuery(value);
    }, 250);
    return () => clearTimeout(t);
  }, [value, writeQuery]);

  const clear = () => {
    setValue("");
    // Clearing is an explicit user gesture — flush immediately, don't wait
    // for the debounce. Update lastPushedRef so the effect treats the
    // resulting state change as already-synced and skips a redundant push.
    lastPushedRef.current = "";
    writeQuery("");
  };

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          // Mirror the final composed value so the debounce effect picks
          // it up on the next render.
          setValue(e.currentTarget.value);
        }}
        placeholder="Search events…"
        aria-label="Search events"
        className="w-56 rounded-md border border-border bg-card pl-7 pr-7 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:border-border-strong focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function FilterChip({
  selected,
  onClick,
  dotClass,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  dotClass?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-border-strong"
      }`}
    >
      {dotClass && (
        <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      )}
      {children}
    </button>
  );
}

// ─── Month view ──────────────────────────────────────────────────────────────

function MonthView({
  month,
  milestones,
  now,
  draftByEvent,
  onPrev,
  onNext,
  onToday,
}: {
  month: Date;
  milestones: MilestoneHit[];
  now: Date;
  draftByEvent: Map<string, { id: string; updated_at: string }>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  // Build 6-row, 7-col grid (Monday-first).
  const firstOfMonth = startOfMonth(month);
  // Convert JS day-of-week (Sun=0 … Sat=6) → Mon-first (Mon=0 … Sun=6).
  const firstDow = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth(),
    1 - firstDow,
  );
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(
      new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
    );
  }

  const monthLabel = month.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  // One open-cell at a time. Identified by yyyy-mm-dd of the cell date.
  // No reset effect needed: when `month` changes, cells remount under new
  // ISO keys, so a stale openKey simply matches no cell and nothing
  // renders. New clicks reassign correctly.
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg tracking-wide">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToday}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPrev}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday header row */}
      <div className="grid grid-cols-7 text-[10px] uppercase tracking-wider text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 pb-1.5">
            {d}
          </div>
        ))}
      </div>

      {/* Date cells */}
      <div className="grid grid-cols-7 gap-px rounded-md border border-border bg-border overflow-hidden">
        {cells.map((cellDate, idx) => {
          const inMonth = cellDate.getMonth() === month.getMonth();
          const isToday = sameDay(cellDate, now);
          const hits = milestones.filter((m) => sameDay(m.date, cellDate));
          // Sort: event last (most "terminal"), others by time.
          hits.sort((a, b) => {
            if (a.kind === "event" && b.kind !== "event") return 1;
            if (b.kind === "event" && a.kind !== "event") return -1;
            return a.date.getTime() - b.date.getTime();
          });
          const cellKey = toYmd(cellDate);
          const open = openKey === cellKey;
          // Edge-aware placement using grid index. The 7×6 grid is fixed,
          // so col == idx % 7 and row == Math.floor(idx / 7).
          const col = idx % 7;
          const row = Math.floor(idx / 7);
          const align = col >= 5 ? "right" : "left";
          const placement = row >= 4 ? "above" : "below";
          const hasHits = hits.length > 0;
          // Out-of-month cells keep the dim bg-muted/40 cue and skip the
          // heatmap tint — heatmap is for the visible month only.
          const cellBg = inMonth ? heatmapTintClass(hits.length) : "bg-muted/40";

          return (
            <DayCell
              key={cellDate.toISOString()}
              cellDate={cellDate}
              inMonth={inMonth}
              isToday={isToday}
              hits={hits}
              hasHits={hasHits}
              open={open}
              align={align}
              placement={placement}
              cellBg={cellBg}
              now={now}
              draftByEvent={draftByEvent}
              onOpen={() => setOpenKey(cellKey)}
              onClose={() => setOpenKey(null)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Day cell ────────────────────────────────────────────────────────────────

function DayCell({
  cellDate,
  inMonth,
  isToday,
  hits,
  hasHits,
  open,
  align,
  placement,
  cellBg,
  now,
  draftByEvent,
  onOpen,
  onClose,
}: {
  cellDate: Date;
  inMonth: boolean;
  isToday: boolean;
  hits: MilestoneHit[];
  hasHits: boolean;
  open: boolean;
  align: "left" | "right";
  placement: "below" | "above";
  /** Pre-bucketed background classes from heatmapTintClass / out-of-month. */
  cellBg: string;
  now: Date;
  draftByEvent: Map<string, { id: string; updated_at: string }>;
  onOpen: () => void;
  onClose: () => void;
}) {
  // The day-number / "+N more" trigger. When the cell has no hits the
  // day number stays a passive span — there's nothing to expand.
  const dayNumberCls = `text-xs ${
    isToday
      ? "rounded-full bg-foreground px-1.5 py-0.5 text-background font-semibold"
      : inMonth
        ? "text-foreground"
        : "text-muted-foreground/60"
  }`;

  return (
    <div className={`relative min-h-[90px] p-1.5 flex flex-col gap-1 ${cellBg}`}>
      <div className="flex items-center justify-between">
        {hasHits ? (
          <button
            type="button"
            onClick={onOpen}
            className={`${dayNumberCls} hover:underline underline-offset-2`}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            {cellDate.getDate()}
          </button>
        ) : (
          <span className={dayNumberCls}>{cellDate.getDate()}</span>
        )}
        {cellDate.getDay() === 1 && inMonth && (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
            wk{getWeekNumber(cellDate)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 min-h-0 overflow-hidden">
        {hits.slice(0, 3).map((m, i) => (
          <Link
            key={`${m.event.id}-${m.kind}-${i}`}
            href={`/events/${m.event.id}`}
            className="group flex items-center gap-1.5 truncate text-[10px] text-foreground hover:text-foreground"
            title={`${m.event.name} · ${MILESTONE_LABEL[m.kind]}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${MILESTONE_COLOR[m.kind]}`}
            />
            <span className="truncate group-hover:underline">
              {m.event.name}
            </span>
          </Link>
        ))}
        {hits.length > 3 && (
          <button
            type="button"
            onClick={onOpen}
            className="text-left text-[9px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            +{hits.length - 3} more
          </button>
        )}
      </div>

      <DayPopover
        open={open}
        onClose={onClose}
        align={align}
        placement={placement}
        ariaLabel={`Milestones on ${cellDate.toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}`}
      >
        <DayPopoverContent
          cellDate={cellDate}
          hits={hits}
          now={now}
          draftByEvent={draftByEvent}
          onClose={onClose}
        />
      </DayPopover>
    </div>
  );
}

function DayPopoverContent({
  cellDate,
  hits,
  now,
  draftByEvent,
  onClose,
}: {
  cellDate: Date;
  hits: MilestoneHit[];
  now: Date;
  draftByEvent: Map<string, { id: string; updated_at: string }>;
  onClose: () => void;
}) {
  const daysAway = daysBetween(midnightOf(now), midnightOf(cellDate));
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium">
          {cellDate.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          Close
        </button>
      </div>
      <ul className="space-y-1.5">
        {hits.map((m, i) => {
          const latestDraft = draftByEvent.get(m.event.id) ?? null;
          const openCampaignHref = latestDraft
            ? `/campaign/${latestDraft.id}?eventId=${m.event.id}`
            : `/events/${m.event.id}?tab=campaigns`;
          return (
            <li
              key={`${m.event.id}-${m.kind}-${i}`}
              className="flex items-center justify-between gap-2"
            >
              <Link
                href={`/events/${m.event.id}`}
                className="min-w-0 flex-1 truncate text-xs font-medium hover:underline underline-offset-2"
              >
                {m.event.name}
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <MilestoneChip kind={m.kind} daysAway={daysAway} />
                <Link
                  href={openCampaignHref}
                  className="whitespace-nowrap text-[10px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Open campaign
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function getWeekNumber(d: Date): number {
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target.getTime() - firstThursday.getTime();
  return (
    1 +
    Math.round(
      (diff / 86400000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7,
    )
  );
}

// ─── Agenda view ─────────────────────────────────────────────────────────────

function AgendaView({
  milestones,
  now,
  draftByEvent,
  filtersActive,
}: {
  milestones: MilestoneHit[];
  now: Date;
  draftByEvent: Map<string, { id: string; updated_at: string }>;
  filtersActive: boolean;
}) {
  // Group upcoming milestones by yyyy-mm-dd, ascending. "Upcoming" is
  // calendar-day-relative to the stabilised `now`, so a milestone falling
  // earlier today is still listed.
  const todayMidnight = midnightOf(now);
  const upcoming = milestones
    .filter((m) => midnightOf(m.date).getTime() >= todayMidnight.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (upcoming.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
        <p className="font-heading text-lg tracking-wide">
          {filtersActive ? "No events match these filters." : "No upcoming milestones"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtersActive
            ? "Try clearing the kind filter or search query."
            : "Add announcement, presale or general sale dates on an event to see them here."}
        </p>
      </div>
    );
  }

  const groups = new Map<string, MilestoneHit[]>();
  for (const m of upcoming) {
    const key = toYmd(m.date);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([key, hits]) => {
        const d = new Date(key + "T00:00:00");
        const daysAway = daysBetween(todayMidnight, d);
        return (
          <div key={key} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
              {d.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </h3>
            <div className="space-y-1.5">
              {hits.map((m, i) => {
                const latestDraft = draftByEvent.get(m.event.id) ?? null;
                const openCampaignHref = latestDraft
                  ? `/campaign/${latestDraft.id}?eventId=${m.event.id}`
                  : `/events/${m.event.id}?tab=campaigns`;
                return (
                  <div
                    key={`${m.event.id}-${m.kind}-${i}`}
                    className="group flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-2.5 transition-colors hover:border-border-strong"
                  >
                    <Link
                      href={`/events/${m.event.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2.5"
                    >
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${MILESTONE_COLOR[m.kind]}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {m.event.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {MILESTONE_LABEL[m.kind]}
                          {m.event.client?.name
                            ? ` · ${m.event.client.name}`
                            : ""}
                        </p>
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-center gap-3">
                      {m.kind !== "event" && (
                        <span className="text-xs text-muted-foreground">
                          {m.date.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      <MilestoneChip kind={m.kind} daysAway={daysAway} />
                      <Link
                        href={openCampaignHref}
                        className="inline-flex items-center whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        Open campaign
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Legend ──────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-2">
      {MILESTONE_KINDS.map((k) => (
        <div key={k} className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${MILESTONE_COLOR[k]}`} />
          <span>{MILESTONE_LABEL[k]}</span>
        </div>
      ))}
    </div>
  );
}
