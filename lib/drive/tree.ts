/**
 * The event Drive tree (S18), the on-sale w/c cadence (S19, HS13), where an
 * approved Lab render is filed (S20) and its file name (S14).
 *
 * Pure: no Drive, no database. Keys are stable paths, never display names,
 * so a renamed or re-dated event keeps every key (S19, S27).
 *
 * Record: docs/design-record/2026-11-09-creative-lab-clip-selection.html.
 */

import { lastFridayOfMonth } from "../creative-lab/payday.ts";

export type FolderKey = string;

export type FolderSpec = {
  key: FolderKey;
  /** null for a top-level folder: the client folder's parent is the Shared Drive root. */
  parent: FolderKey | null;
  name: string;
  /** client-level folders carry event_id null in the map. */
  level: "client" | "event";
};

export const CLIENT_KEY = "client";
export const BRAND_KIT_KEY = "brand-kit";
export const EVENT_KEY = "event";
export const WINNERS_KEY = "winners";
export const ON_SALE_KEY = "03/3";
export const SHOW_WEEK_KEY = "03/4";
export const ARTIST_CLIPS_KEY = "02/artist-clips";
export const PRESS_KITS_KEY = "02/press-kits";

/** {Client}/ and _Brand kit, created when a client is (S19). */
export function clientSpecs(client: { name: string }): FolderSpec[] {
  return [
    { key: CLIENT_KEY, parent: null, name: clientFolderName(client), level: "client" },
    { key: BRAND_KIT_KEY, parent: CLIENT_KEY, name: "_Brand kit", level: "client" },
  ];
}

/**
 * Every event folder but the w/c ones, names verbatim from S18. Order is
 * parent before child. {artist} folders are made per artist, not here.
 */
export const EVENT_TREE: readonly FolderSpec[] = [
  { key: "00", parent: EVENT_KEY, name: "00 Brief & admin", level: "event" },
  { key: "01", parent: EVENT_KEY, name: "01 Open files", level: "event" },
  { key: "02", parent: EVENT_KEY, name: "02 Source", level: "event" },
  { key: ARTIST_CLIPS_KEY, parent: "02", name: "Artist clips", level: "event" },
  { key: PRESS_KITS_KEY, parent: "02", name: "Press kits", level: "event" },
  { key: "02/venue-crowd", parent: "02", name: "Venue & crowd", level: "event" },
  { key: "03", parent: EVENT_KEY, name: "03 Creatives", level: "event" },
  { key: "03/1", parent: "03", name: "1 Signup", level: "event" },
  { key: "03/1/teaser", parent: "03/1", name: "Teaser", level: "event" },
  { key: "03/1/teaser/artist", parent: "03/1/teaser", name: "Artist", level: "event" },
  { key: "03/1/teaser/promoter", parent: "03/1/teaser", name: "Promoter", level: "event" },
  { key: "03/1/teaser/experience", parent: "03/1/teaser", name: "Experience", level: "event" },
  { key: "03/1/announcement", parent: "03/1", name: "Announcement", level: "event" },
  { key: "03/2", parent: "03", name: "2 Presale", level: "event" },
  { key: "03/2/presale-live", parent: "03/2", name: "Presale live", level: "event" },
  { key: "03/2/reminders", parent: "03/2", name: "Reminders", level: "event" },
  { key: ON_SALE_KEY, parent: "03", name: "3 On sale", level: "event" },
  { key: SHOW_WEEK_KEY, parent: "03", name: "4 Show week", level: "event" },
  { key: "04", parent: EVENT_KEY, name: "04 D2C", level: "event" },
  { key: "05", parent: EVENT_KEY, name: "05 Reports", level: "event" },
  { key: "06", parent: EVENT_KEY, name: "06 Post-event", level: "event" },
  { key: WINNERS_KEY, parent: EVENT_KEY, name: "_Winners", level: "event" },
];

export const CANCELLED_SUFFIX = " (cancelled)";

/** Client name as written on the record (S13). */
export function clientFolderName(client: { name: string }): string {
  const name = client.name.trim();
  if (!name) throw new Error("client has no name");
  return name;
}

/**
 * {YYYY-MM-DD} {Event name} [{CODE}] — the code verbatim, never normalised.
 * No code drops the brackets; no date drops the date (S13).
 */
export function eventFolderName(event: { name: string; event_date?: string | null; event_code?: string | null; status?: string | null }): string {
  const name = event.name.trim();
  if (!name) throw new Error("event has no name");
  const day = event.event_date?.slice(0, 10);
  const code = event.event_code?.trim();
  const base = [day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null, name].filter(Boolean).join(" ");
  const full = code ? `${base} [${code}]` : base;
  return isCancelled(event.status) ? `${full}${CANCELLED_SUFFIX}` : full;
}

export function isCancelled(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "cancelled";
}

// ─── Dates (calendar days, London) ───────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function londonToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week holding `iso` (weeks start Monday). */
export function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

/** "w/c 16 Nov" */
export function cycleFolderName(monday: string): string {
  const [, month, day] = monday.split("-").map(Number);
  return `w/c ${day} ${MONTHS[month - 1]}`;
}

export function cycleKey(monday: string): FolderKey {
  return `${ON_SALE_KEY}/wc/${monday}`;
}

export const CYCLE_CHILDREN = [
  { slug: "ugc", name: "UGC" },
  { slug: "ticket-warnings", name: "Ticket warnings" },
  { slug: "content", name: "Content" },
] as const;

export function cycleSpecs(monday: string): FolderSpec[] {
  const key = cycleKey(monday);
  return [
    { key, parent: ON_SALE_KEY, name: cycleFolderName(monday), level: "event" },
    ...CYCLE_CHILDREN.map((child) => ({ key: `${key}/${child.slug}`, parent: key, name: child.name, level: "event" as const })),
  ];
}

// ─── The w/c cadence (S19, HS13) ─────────────────────────────────────────────

/**
 * The cycle Mondays in [from, to]. Injectable so a test can give the record's
 * "paydays fortnightly from 2 Nov" calendar.
 */
export type CycleCalendar = (from: string, to: string) => string[];

/**
 * The payday calendar in code (lib/creative-lab/payday.ts): pay lands on the
 * last Friday of the month. Each month has two cycles: the payday-led one from
 * the Monday of payday week, and the content-led one a fortnight later — the
 * fortnightly refresh S18 describes. A month whose next payday week is five
 * weeks away keeps its second cycle for three weeks rather than adding a
 * one-week cycle.
 */
export const paydayCycleMondays: CycleCalendar = (from, to) => {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7)) - 1;
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  const paydayMonday = (y: number, m: number) => mondayOf(`${y}-${String(m).padStart(2, "0")}-${String(lastFridayOfMonth(y, m)).padStart(2, "0")}`);
  for (let i = 0; i < 400; i += 1) {
    const monday = paydayMonday(year, month);
    if (monday > to) break;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const next = paydayMonday(nextYear, nextMonth);
    for (const day of [monday, addDays(monday, 14)]) {
      if (day < next && day >= from && day <= to) out.push(day);
    }
    year = nextYear;
    month = nextMonth;
  }
  return out;
};

/** A fixed fortnightly grid from an anchor Monday — the record's HS13 example. */
export function fortnightlyFrom(anchor: string): CycleCalendar {
  return (from, to) => {
    const out: string[] = [];
    let day = anchor;
    while (day > from) day = addDays(day, -14);
    for (; day <= to; day = addDays(day, 14)) if (day >= from) out.push(day);
    return out;
  };
}

/** The Monday of the show's week. From then on, on-sale filing goes to 4 Show week (S19). */
export function showWeekMonday(eventDate: string | null | undefined): string | null {
  const day = eventDate?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? mondayOf(day) : null;
}

/** The cycle holding `day`: the latest cycle Monday on or before it. */
export function cycleMondayFor(day: string, calendar: CycleCalendar = paydayCycleMondays): string {
  const mondays = calendar(addDays(day, -70), day);
  const last = mondays.at(-1);
  if (!last) throw new Error(`no payday cycle found before ${day}`);
  return last;
}

export type CycleInput = {
  today: string;
  onSale: boolean;
  /** the on-sale day, when known. A cycle is never created before it. */
  onSaleFrom: string | null;
  eventDate: string | null;
  calendar?: CycleCalendar;
};

/**
 * The w/c folder that should exist today, or null: not on sale yet, or show
 * week has begun (no further w/c folders). Going on sale mid-cycle gives the
 * current cycle at once. Only the current cycle is returned — a missed day
 * catches up on the next run, and past cycles are never made empty.
 */
export function cycleDue(input: CycleInput): string | null {
  if (!input.onSale) return null;
  if (input.onSaleFrom && input.today < input.onSaleFrom) return null;
  const showWeek = showWeekMonday(input.eventDate);
  if (showWeek && input.today >= showWeek) return null;
  return cycleMondayFor(input.today, input.calendar);
}

// ─── Routing an approved render (S20) ────────────────────────────────────────

export type RenderStage = "signup" | "on-sale";

/** events.status on_sale is on sale; every other live status is signup. */
export function renderStage(eventStatus: string | null | undefined): RenderStage {
  return (eventStatus ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_") === "on_sale" ? "on-sale" : "signup";
}

/** The style key with hyphens (S14). A quote-mode caption is "quote". */
export function angleSlug(style: string, mode?: string | null): string {
  if (mode === "quote" || style === "quote") return "quote";
  return style.trim().toLowerCase().replace(/_/g, "-");
}

const ARTIST_VOICE = new Set(["artist-first-person", "quote"]);

export type RouteInput = {
  stage: RenderStage;
  angle: string;
  today: string;
  eventDate: string | null;
  calendar?: CycleCalendar;
};

/**
 * Where an approved render goes. Show week first: from its Monday every render
 * goes to 4 Show week. Signup splits by voice: artist-first-person and quote →
 * Teaser/Artist, every other angle → Teaser/Promoter. On sale → the current
 * cycle's UGC.
 */
export function routeRender(input: RouteInput): { key: FolderKey; cycle: string | null } {
  const showWeek = showWeekMonday(input.eventDate);
  if (showWeek && input.today >= showWeek) return { key: SHOW_WEEK_KEY, cycle: null };
  if (input.stage === "signup") {
    return { key: ARTIST_VOICE.has(input.angle) ? "03/1/teaser/artist" : "03/1/teaser/promoter", cycle: null };
  }
  const monday = cycleMondayFor(input.today, input.calendar);
  return { key: `${cycleKey(monday)}/ugc`, cycle: monday };
}

/** Every key in the tree, parent first, for one cycle Monday or none. */
export function specFor(key: FolderKey): FolderSpec | null {
  const fixed = EVENT_TREE.find((spec) => spec.key === key);
  if (fixed) return fixed;
  const match = /^03\/3\/wc\/(\d{4}-\d{2}-\d{2})(?:\/([a-z-]+))?$/.exec(key);
  if (!match) return null;
  return cycleSpecs(match[1]).find((spec) => spec.key === key) ?? null;
}

// ─── File name (S14) ─────────────────────────────────────────────────────────

/** Lower-case with hyphens, accents dropped, nothing else changed. */
export function artistSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function formatSlug(aspect: string): string {
  return aspect.trim().replace(":", "x");
}

export type RenderNameInput = {
  eventCode: string | null;
  artistName: string;
  clipNo: number;
  angle: string;
  captionNo: number;
  stage: RenderStage;
  roundNo: number;
  aspect: string;
  extension?: string;
  version?: number;
  winner?: boolean;
};

/**
 * {event code}_{artist}-{clip n}_{angle}{caption n}-{stage}_r{n}[_v{k}]_{format}[_winner].{ext}
 * → P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4. No code: no prefix.
 */
export function renderFileName(input: RenderNameInput): string {
  const code = input.eventCode?.trim();
  const version = input.version && input.version > 1 ? `_v${input.version}` : "";
  const winner = input.winner ? "_winner" : "";
  const ext = (input.extension ?? "mp4").replace(/^\./, "");
  const body = `${artistSlug(input.artistName)}-${input.clipNo}_${input.angle}${input.captionNo}-${input.stage}_r${input.roundNo}${version}_${formatSlug(input.aspect)}${winner}.${ext}`;
  return code ? `${code}_${body}` : body;
}

/** The first name of the pairing not already in the folder: _v2, _v3, … never overwrite. */
export function freeRenderFileName(input: Omit<RenderNameInput, "version">, taken: ReadonlySet<string>): string {
  for (let version = 1; version < 1000; version += 1) {
    const plain = renderFileName({ ...input, version, winner: false });
    const won = renderFileName({ ...input, version, winner: true });
    if (!taken.has(plain) && !taken.has(won)) return input.winner ? won : plain;
  }
  throw new Error("no free file name");
}

/** …_r1_9x16.mp4 → …_r1_9x16_winner.mp4. Already a winner: unchanged. */
export function winnerFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return stem.endsWith("_winner") ? name : `${stem}_winner${ext}`;
}
