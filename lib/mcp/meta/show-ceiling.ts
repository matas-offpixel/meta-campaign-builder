/**
 * lib/mcp/meta/show-ceiling.ts — the per-show spend ceiling (PR D).
 *
 * Matas, 26 Nov: "the ceiling is the campaign budget". A change through the
 * connector that starts or raises spend is refused when the show's committed
 * spend would pass its ceiling. Committed spend, each part from its source:
 *   - spent to date: ad_daily_insights, summed over every ad in the show's
 *     campaigns (events.meta_campaign_id, launched_ad_sets and the show's
 *     published drafts, deleted campaigns included), paged in 1,000-row
 *     ranges (PostgREST's cap);
 *   - live lifetime budgets: what Meta says is left (budget_remaining), read
 *     now;
 *   - live daily budgets: the daily budget × the London days left, today
 *     included, to the object's end (the ad set's, else its campaign's) or,
 *     with no end, to show day (events.event_date), read from Meta now;
 *   - the change itself: its objects as they'd be after it (a resumed ad set,
 *     a raised budget, a move) and any new spend it adds (a draft's launch,
 *     Job 4's new campaigns), each a budget line in £.
 * A budget is live when its own status is ACTIVE and, for an ad set, its
 * campaign's is too. A campaign budget (CBO) counts once, on the campaign.
 * An ended object counts nothing more. Ads hold no budget: resuming an ad,
 * or adding live ads, counts the ad set's budget as committed already.
 *
 * The ceiling, in order:
 *   1. the show's own row in show_spend_ceilings, and/or its group's (a total
 *      shared by every show in the group: their committed spend is summed);
 *      every one that applies must hold;
 *   2. else the show's default by its exact code (SHOW_DEFAULTS: P26-BDAY),
 *      else the brand default by event-code prefix (BRAND_DEFAULTS); both in
 *      code: Matas's ruling, reviewed and tested with what reads it;
 *   3. else none: refused, as before.
 * A change that starts spend (a live launch, a resume, live ads) is checked
 * whatever its numbers. A budget change is checked only when it raises the
 * show's committed spend: a cut, or a move that doesn't raise it, is never
 * blocked, and needs no ceiling. Pauses, renames and paused builds never call
 * this.
 *
 * Accounts not in £ are refused: the changed object's own account by the
 * caller (its existing words), every other account the show's budgets or
 * spend sit on here. Every amount is £, 2 dp.
 *
 * Relative imports only (node:test).
 */
import type { CampaignDraft } from "../../types.ts";
import { loadCampaignTree, loadEventAdSets, loadEventDrafts, splitCampaignIds, type LoadedTree, type TreeDb } from "../../campaign-tree/load.ts";
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { adSetAudienceRemoved } from "../../wizard/import-edits.ts";
import type { LiveObject, McpLiveDeps } from "../live/types.ts";
import { LIVE_WORDS } from "../live/words.ts";
import { ToolInputError, type Db } from "../tool-types.ts";
import { CEILING_WORDS, type CeilingSource } from "./ceiling-words.ts";

// ─── Brand defaults (Matas, 26 Nov) ──────────────────────────────────────

export interface BrandDefault {
  /** The event code's leading letters: "NX" for NX26-AZYR. */
  brand: string;
  /** £ total per show; null = none (set per show). */
  totalGbp: number | null;
  note: string;
}

/** By the code's leading letters, matched whole (ES never matches EBR). Matas, 26 Nov. */
export const BRAND_DEFAULTS: readonly BrandDefault[] = [
  { brand: "NX", totalGbp: 3000, note: "NX" },
  { brand: "ES", totalGbp: 2500, note: "Electric Sheffield" },
  { brand: "EBR", totalGbp: 2500, note: "Electric Bristol" },
  { brand: "AS", totalGbp: 2000, note: "unless set per show" },
  { brand: "DHB", totalGbp: null, note: "none: set per show" },
];

export interface ShowDefault {
  /** The whole event code, matched exactly (case-insensitive). */
  code: string;
  totalGbp: number;
  note: string;
}

/**
 * Defaults for one show by its exact code, before the brand's (Matas, 26 Nov).
 * P26 has no brand default: P26-BDAY (4th Birthday parts 1 and 2 on 27 Dec,
 * marketed as one event) is £4,500 on its own, and every other P26 code,
 * the cancelled P26-BDAY-DAY and P26-BDAY-NIGHT included, has no ceiling
 * until one is set for it.
 */
export const SHOW_DEFAULTS: readonly ShowDefault[] = [{ code: "P26-BDAY", totalGbp: 4500, note: "4th Birthday parts 1 and 2, 27 Dec, one event" }];

export function brandOf(code: string | null | undefined): string | null {
  const m = /^([A-Za-z]+)/.exec((code ?? "").trim());
  return m ? m[1]!.toUpperCase() : null;
}

export function brandDefault(code: string | null | undefined): BrandDefault | null {
  const brand = brandOf(code);
  return brand ? (BRAND_DEFAULTS.find((d) => d.brand === brand) ?? null) : null;
}

/** The default that applies to a code with no row: its exact show default, else its brand's. */
export function codeDefault(code: string | null | undefined): { key: string; totalGbp: number | null } | null {
  const c = (code ?? "").trim().toUpperCase();
  const show = SHOW_DEFAULTS.find((d) => d.code === c);
  if (show) return { key: show.code, totalGbp: show.totalGbp };
  const brand = brandDefault(code);
  return brand ? { key: brand.brand, totalGbp: brand.totalGbp } : null;
}

// ─── Ceilings ────────────────────────────────────────────────────────────

export interface ResolvedCeiling {
  totalGbp: number;
  source: CeilingSource;
  /** The shows whose committed spend counts against it. */
  eventIds: string[];
}

export type CeilingResolution =
  | { kind: "set"; ceilings: ResolvedCeiling[] }
  | { kind: "none" };

interface ShowEvent {
  id: string;
  code: string;
  eventDate: string | null;
}

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The show's ceilings. Throws (unread) when a row can't be read: refuse, never assume. */
export async function resolveShowCeiling(db: Db, event: { id: string; code: string }): Promise<CeilingResolution> {
  const unread = () => new ToolInputError(CEILING_WORDS.unread(event.code), { refused: "ceiling_unreadable", eventId: event.id });
  const ceilings: ResolvedCeiling[] = [];
  const own = await db.from("show_spend_ceilings").select("id, total_gbp").eq("event_id", event.id).maybeSingle();
  if (own.error) throw unread();
  if (own.data) {
    const total = money((own.data as { total_gbp: unknown }).total_gbp);
    if (total == null) throw unread();
    ceilings.push({ totalGbp: total, source: { kind: "own" }, eventIds: [event.id] });
  }
  const member = await db.from("show_spend_ceiling_events").select("ceiling_id").eq("event_id", event.id).maybeSingle();
  if (member.error) throw unread();
  if (member.data) {
    const ceilingId = (member.data as { ceiling_id: string }).ceiling_id;
    const group = await db.from("show_spend_ceilings").select("id, group_name, total_gbp").eq("id", ceilingId).maybeSingle();
    if (group.error || !group.data) throw unread();
    const g = group.data as { group_name: string | null; total_gbp: unknown };
    const total = money(g.total_gbp);
    if (total == null || !g.group_name) throw unread();
    const members = await db.from("show_spend_ceiling_events").select("event_id").eq("ceiling_id", ceilingId);
    if (members.error) throw unread();
    const ids = [...new Set([event.id, ...((members.data ?? []) as Array<{ event_id: string }>).map((m) => m.event_id)])].sort();
    const codes = await db.from("events").select("id, event_code").in("id", ids);
    if (codes.error) throw unread();
    const byId = new Map(((codes.data ?? []) as Array<{ id: string; event_code: string | null }>).map((r) => [r.id, r.event_code ?? r.id]));
    ceilings.push({ totalGbp: total, source: { kind: "group", codes: ids.map((id) => byId.get(id) ?? id).sort() }, eventIds: ids });
  }
  if (ceilings.length > 0) return { kind: "set", ceilings };
  const d = codeDefault(event.code);
  if (!d || d.totalGbp == null) return { kind: "none" };
  return { kind: "set", ceilings: [{ totalGbp: d.totalGbp, source: { kind: "default", brand: d.key }, eventIds: [event.id] }] };
}

// ─── Days ────────────────────────────────────────────────────────────────

const londonDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const dayNo = (ymd: string) => Math.round(Date.parse(`${ymd}T12:00:00Z`) / 86_400_000);

/** A draft's wall-clock date ("2026-12-20T23:59", no zone) is London time; Meta's times carry a zone. */
const ZONELESS = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

/** The London day of a time, and whether it has passed. Null when it can't be read. */
function londonDay(iso: string, now: Date): { day: string; passed: boolean } | null {
  if (ZONELESS.test(iso)) {
    const day = iso.slice(0, 10);
    if (Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return null;
    const today = londonDate(now);
    // A zoneless end with a time: passed once that wall-clock time has gone in London.
    const wall = iso.length > 10 ? iso.slice(11, 16) : "23:59";
    const nowWall = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    return { day, passed: day < today || (day === today && wall <= nowWall) };
  }
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return { day: londonDate(t), passed: t.getTime() <= now.getTime() };
}

/** The later of `from` and now, as a London day. */
function startDay(fromIso: string | null | undefined, now: Date): string {
  const today = londonDate(now);
  if (!fromIso) return today;
  const f = londonDay(fromIso, now);
  return f && !f.passed && f.day > today ? f.day : today;
}

/** London days from `from` (or today, if later) to `end`, both included. 0 once the end has passed. */
export function daysLeft(endIso: string, now: Date, fromIso?: string | null): number {
  const end = londonDay(endIso, now);
  if (!end || end.passed) return 0;
  const from = startDay(fromIso, now);
  if (end.day < from) return 0;
  return dayNo(end.day) - dayNo(from) + 1;
}

/** Days to show day, today and show day included; at least 1 (a budget still on after show day counts today). */
export function daysToShow(eventDate: string, now: Date, fromIso?: string | null): number {
  return Math.max(1, dayNo(eventDate.slice(0, 10)) - dayNo(startDay(fromIso, now)) + 1);
}

// ─── Budget lines ────────────────────────────────────────────────────────

/** New spend a change adds, in £ (a draft's launch, a new campaign). */
export interface AddedLine {
  label: string;
  dailyGbp?: number | null;
  lifetimeGbp?: number | null;
  start?: string | null;
  end?: string | null;
}

/** A live object as it would be after the change. */
export interface ObjectOverride {
  kind: "campaign" | "adset";
  id: string;
  status?: "ACTIVE";
  dailyMinor?: number;
  lifetimeMinor?: number;
}

export interface ShowChange {
  /** True for a change that starts spend (a live launch, a resume, live ads): checked whatever its numbers. */
  starts: boolean;
  objects?: ObjectOverride[];
  added?: AddedLine[];
}

interface Totals {
  lifetime: number;
  daily: number;
}

class Unbounded extends Error {
  readonly what: string;
  constructor(what: string) {
    super("unbounded");
    this.what = what;
  }
}

type BudgetObject = Pick<LiveObject, "id" | "name" | "status" | "dailyBudgetMinor" | "lifetimeBudgetMinor" | "budgetRemainingMinor" | "startTime" | "endTime" | "accountId">;

function lineOf(o: BudgetObject, end: string | null, show: ShowEvent, now: Date): { lifetime: number; daily: number } {
  if (o.endTime && Date.parse(o.endTime) <= now.getTime()) return { lifetime: 0, daily: 0 };
  if (o.lifetimeBudgetMinor != null && o.lifetimeBudgetMinor > 0) {
    const left = o.budgetRemainingMinor != null && o.budgetRemainingMinor >= 0 ? o.budgetRemainingMinor : o.lifetimeBudgetMinor;
    return { lifetime: left / 100, daily: 0 };
  }
  if (o.dailyBudgetMinor != null && o.dailyBudgetMinor > 0) {
    let days: number;
    if (end) days = daysLeft(end, now, o.startTime);
    else if (show.eventDate) days = daysToShow(show.eventDate, now, o.startTime);
    else throw new Unbounded(o.name || o.id);
    return { lifetime: 0, daily: (o.dailyBudgetMinor / 100) * days };
  }
  return { lifetime: 0, daily: 0 };
}

export function addedLine(a: AddedLine, show: ShowEvent, now: Date): Totals {
  if (a.lifetimeGbp != null && a.lifetimeGbp > 0) return { lifetime: a.lifetimeGbp, daily: 0 };
  if (a.dailyGbp != null && a.dailyGbp > 0) {
    let days: number;
    if (a.end) days = daysLeft(a.end, now, a.start);
    else if (show.eventDate) days = daysToShow(show.eventDate, now, a.start);
    else throw new Unbounded(a.label);
    return { lifetime: 0, daily: a.dailyGbp * days };
  }
  return { lifetime: 0, daily: 0 };
}

export interface CampaignBudgets {
  campaign: BudgetObject;
  adsets: BudgetObject[];
}

/** What the show's live budgets still commit, with the overrides applied. Also the accounts of the budgets that count. */
export function committedBudgets(campaigns: CampaignBudgets[], show: ShowEvent, now: Date, overrides: ObjectOverride[] = []): Totals & { accounts: Set<string> } {
  const apply = (o: BudgetObject, kind: "campaign" | "adset"): BudgetObject => {
    const ov = overrides.find((x) => x.kind === kind && x.id === o.id);
    if (!ov) return o;
    const next = { ...o };
    if (ov.status) next.status = ov.status;
    if (ov.dailyMinor != null) next.dailyBudgetMinor = ov.dailyMinor;
    if (ov.lifetimeMinor != null) {
      // Spent so far on it stays spent: what's left moves by the change.
      const spent = Math.max(0, (o.lifetimeBudgetMinor ?? 0) - (o.budgetRemainingMinor ?? o.lifetimeBudgetMinor ?? 0));
      next.lifetimeBudgetMinor = ov.lifetimeMinor;
      next.budgetRemainingMinor = Math.max(0, ov.lifetimeMinor - spent);
    }
    return next;
  };
  const out = { lifetime: 0, daily: 0, accounts: new Set<string>() };
  for (const c of campaigns) {
    const camp = apply(c.campaign, "campaign");
    if (camp.status !== "ACTIVE") continue;
    const cbo = (camp.dailyBudgetMinor ?? 0) > 0 || (camp.lifetimeBudgetMinor ?? 0) > 0;
    if (cbo) {
      const l = lineOf(camp, camp.endTime, show, now);
      out.lifetime += l.lifetime;
      out.daily += l.daily;
      if ((l.lifetime > 0 || l.daily > 0) && camp.accountId) out.accounts.add(camp.accountId);
      continue;
    }
    for (const raw of c.adsets) {
      const s = apply(raw, "adset");
      if (s.status !== "ACTIVE") continue;
      const l = lineOf(s, s.endTime ?? camp.endTime, show, now);
      out.lifetime += l.lifetime;
      out.daily += l.daily;
      const account = s.accountId ?? camp.accountId;
      if ((l.lifetime > 0 || l.daily > 0) && account) out.accounts.add(account);
    }
  }
  return out;
}

// ─── Draft launches ──────────────────────────────────────────────────────

/** A draft's launch as one budget line, as the launch would set it (the launch route's enabled ad sets). */
export function draftAddedLine(draft: Pick<CampaignDraft, "budgetSchedule" | "adSetSuggestions" | "settings"> & { audiences?: CampaignDraft["audiences"] }): AddedLine {
  const b = draft.budgetSchedule;
  const level = b?.budgetLevel ?? "ad_set";
  const type = b?.budgetType ?? "daily";
  const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const audiences = draft.audiences;
  const enabled = (draft.adSetSuggestions ?? []).filter((s) => s.enabled && !(audiences && adSetAudienceRemoved(s, audiences)));
  const label = draft.settings?.campaignName || "this draft";
  const dates = { start: b?.startDate || null, end: b?.endDate || null };
  if (level === "campaign") {
    const amount = pos(b?.budgetAmount);
    return type === "lifetime" ? { label, lifetimeGbp: amount, ...dates } : { label, dailyGbp: amount, ...dates };
  }
  if (type === "lifetime") return { label, lifetimeGbp: enabled.reduce((sum, s) => sum + pos((s as { budgetLifetime?: number }).budgetLifetime), 0), ...dates };
  return { label, dailyGbp: enabled.reduce((sum, s) => sum + pos(s.budgetPerDay), 0), ...dates };
}

// ─── Reads ───────────────────────────────────────────────────────────────

export type ShowCeilingReads = Pick<McpLiveDeps, "readCampaigns" | "readObjects" | "readChildren" | "accountInfo">;

const PAGE = 1000;
const IN_CHUNK = 100;

/** Every campaign the show has had, deleted ones included (their spend still counts). */
async function spendCampaignIds(db: Db, tree: LoadedTree): Promise<string[]> {
  const [drafts, adSets] = await Promise.all([loadEventDrafts(db as unknown as TreeDb, tree.event.id), loadEventAdSets(db as unknown as TreeDb, tree.event.id)]);
  const ids = [
    ...splitCampaignIds(tree.event.meta_campaign_id),
    ...adSets.map((a) => a.meta_campaign_id),
    ...drafts.filter((d) => d.status === "published").map((d) => d.metaCampaignId),
    ...tree.campaigns.map((c) => c.metaCampaignId),
  ].filter((id): id is string => typeof id === "string" && /^\d{5,32}$/.test(id));
  return [...new Set(ids)];
}

/** Spend to date (ad_daily_insights), £, with the last day it covers and the accounts it was spent on. */
export async function spentToDate(db: Db, campaignIds: string[]): Promise<{ spent: number; through: string | null; accounts: Set<string> }> {
  let spent = 0;
  let through: string | null = null;
  const accounts = new Set<string>();
  for (let i = 0; i < campaignIds.length; i += IN_CHUNK) {
    const chunk = campaignIds.slice(i, i + IN_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const page = await db
        .from("ad_daily_insights")
        .select("meta_ad_id, date, spend, ad_account_id")
        .in("meta_campaign_id", chunk)
        .order("date", { ascending: true })
        .order("meta_ad_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (page.error) throw new Error("insights_unread");
      const rows = (page.data ?? []) as Array<{ date: string; spend: number | string | null; ad_account_id: string | null }>;
      for (const r of rows) {
        const s = Number(r.spend ?? 0);
        if (!Number.isFinite(s) || s <= 0) continue;
        spent += s;
        if (!through || r.date > through) through = r.date;
        const account = normalizeAdAccountId(r.ad_account_id);
        if (account) accounts.add(account);
      }
      if (rows.length < PAGE) break;
    }
  }
  return { spent, through, accounts };
}

async function liveBudgets(live: ShowCeilingReads, userId: string, tree: LoadedTree): Promise<CampaignBudgets[]> {
  const ids = tree.campaigns.map((c) => c.metaCampaignId);
  if (ids.length === 0) return [];
  const camps = await live.readObjects(userId, "campaign", ids);
  const out: CampaignBudgets[] = [];
  for (const id of ids) {
    const campaign = camps.objects.get(id);
    if (!campaign) continue;
    const children = await live.readChildren(userId, id);
    out.push({ campaign, adsets: children.adsets });
  }
  return out;
}

// ─── The check ───────────────────────────────────────────────────────────

export interface ShowCommitted {
  spent: number;
  through: string | null;
  lifetime: number;
  daily: number;
  total: number;
}

export interface ShowCeilingChecked {
  /** False when the change didn't raise committed spend (a cut, a neutral move): nothing was checked against a ceiling. */
  checked: boolean;
  /** The tightest ceiling that applied (£), when checked. */
  ceilingGbp: number | null;
  source: CeilingSource | null;
  before: number | null;
  after: number | null;
  /** What this change adds to committed spend (£). */
  delta: number;
  committed: ShowCommitted | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const throughWords = (ymd: string | null) => (ymd ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${ymd}T12:00:00Z`)) : null);

/**
 * The per-show check. `tree` is the show's campaign tree when the caller has
 * it (the live tools' liveEvent); else it's read here. Throws a
 * ToolInputError with the refusal words; returns what was checked for the
 * action log.
 */
export async function checkShowCeiling(input: {
  db: Db;
  live: ShowCeilingReads;
  userId: string;
  /** The show; its code is read when not given. */
  event: { id: string; code?: string | null };
  tree?: LoadedTree;
  change: ShowChange;
  now: Date;
}): Promise<ShowCeilingChecked> {
  const { db, live, userId, change, now } = input;
  let code = input.event.code ?? null;
  if (!code) {
    const ev = await db.from("events").select("id, event_code").eq("id", input.event.id).maybeSingle();
    const row = ev.data as { event_code: string | null } | null;
    if (ev.error || !row) throw new ToolInputError(CEILING_WORDS.unread(input.event.id), { eventId: input.event.id, refused: "ceiling_unreadable" });
    code = row.event_code ?? input.event.id;
  }
  const base = { eventId: input.event.id, code };
  const unread = () => new ToolInputError(CEILING_WORDS.unread(code), { ...base, refused: "ceiling_unreadable" });

  const resolution = await resolveShowCeiling(db, { id: input.event.id, code });
  const refuseNone = (extra: Record<string, unknown> = {}) => new ToolInputError(CEILING_WORDS.none(code), { ...base, refused: "no_ceiling", ...extra });
  // A change that starts spend needs a ceiling before anything is read from Meta.
  if (resolution.kind !== "set" && change.starts) throw refuseNone();

  const eventIds = resolution.kind === "set" ? [...new Set([input.event.id, ...resolution.ceilings.flatMap((c) => c.eventIds)])] : [input.event.id];

  // The shows, their dates and trees.
  const rows = await db.from("events").select("id, event_code, event_date").in("id", eventIds);
  if (rows.error) throw unread();
  const shows = new Map(((rows.data ?? []) as Array<{ id: string; event_code: string | null; event_date: string | null }>).map((r) => [r.id, { id: r.id, code: r.event_code ?? r.id, eventDate: r.event_date ?? null } as ShowEvent]));
  if (!shows.has(input.event.id)) throw unread();

  const per = new Map<string, { before: Totals; after: Totals; tree: LoadedTree; accounts: Set<string> }>();
  try {
    for (const id of eventIds) {
      const show = shows.get(id);
      if (!show) throw new Error("show_missing");
      const tree = id === input.event.id && input.tree ? input.tree : await loadCampaignTree(db as unknown as TreeDb, { readCampaigns: (ids) => live.readCampaigns(userId, ids) }, id);
      if (!tree) throw new Error("tree_unread");
      const budgets = await liveBudgets(live, userId, tree);
      const before = committedBudgets(budgets, show, now);
      const after = committedBudgets(budgets, show, now, change.objects ?? []);
      if (id === input.event.id) {
        for (const a of change.added ?? []) {
          const l = addedLine(a, show, now);
          after.lifetime += l.lifetime;
          after.daily += l.daily;
        }
      }
      per.set(id, { before, after, tree, accounts: new Set([...before.accounts, ...after.accounts]) });
    }
  } catch (e) {
    if (e instanceof Unbounded) throw new ToolInputError(CEILING_WORDS.unbounded(e.what, code), { ...base, refused: "unbounded" });
    if (e instanceof ToolInputError) throw e;
    throw new ToolInputError(LIVE_WORDS.readFailed, { ...base, refused: "meta_unread" });
  }

  const subject = per.get(input.event.id)!;
  const sum = (t: Totals) => t.lifetime + t.daily;
  const delta = round2(sum(subject.after) - sum(subject.before));
  if (!change.starts && delta <= 0) return { checked: false, ceilingGbp: null, source: null, before: null, after: null, delta, committed: null };
  if (resolution.kind !== "set") throw refuseNone({ delta });

  // Spent to date, per show.
  const spent = new Map<string, Awaited<ReturnType<typeof spentToDate>>>();
  try {
    for (const [id, p] of per) spent.set(id, await spentToDate(db, await spendCampaignIds(db, p.tree)));
  } catch {
    throw unread();
  }

  // Every account the counted spend and budgets sit on must spend in £.
  const accounts = new Set<string>();
  for (const [id, p] of per) {
    for (const a of p.accounts) accounts.add(normalizeAdAccountId(a) ?? a);
    for (const a of spent.get(id)!.accounts) accounts.add(a);
  }
  for (const account of [...accounts].sort()) {
    let currency: string;
    try {
      currency = ((await live.accountInfo(userId, account)).currency ?? "GBP").toUpperCase();
    } catch {
      throw new ToolInputError(LIVE_WORDS.readFailed, { ...base, refused: "account_unread" });
    }
    if (currency !== "GBP") throw new ToolInputError(CEILING_WORDS.otherCurrency(code, account, currency), { ...base, refused: "not_gbp", account, currency });
  }

  let tightest: ShowCeilingChecked | null = null;
  for (const c of resolution.ceilings) {
    const part = { spent: 0, through: null as string | null, lifetime: 0, daily: 0, before: 0 };
    for (const id of c.eventIds) {
      const p = per.get(id)!;
      const s = spent.get(id)!;
      part.spent += s.spent;
      if (s.through && (!part.through || s.through > part.through)) part.through = s.through;
      part.lifetime += p.after.lifetime;
      part.daily += p.after.daily;
      part.before += sum(p.before);
    }
    const after = round2(part.spent + part.lifetime + part.daily);
    const before = round2(part.spent + part.before);
    const committed: ShowCommitted = { spent: round2(part.spent), through: part.through, lifetime: round2(part.lifetime), daily: round2(part.daily), total: after };
    if (after > c.totalGbp) {
      throw new ToolInputError(
        CEILING_WORDS.over({ show: code, after, ceiling: c.totalGbp, source: c.source, spent: committed.spent, through: throughWords(part.through), lifetime: committed.lifetime, daily: committed.daily, delta }),
        { ...base, refused: "over_ceiling", ceilingGbp: c.totalGbp, source: c.source, before, after, delta, committed },
      );
    }
    if (!tightest || c.totalGbp - after < (tightest.ceilingGbp ?? 0) - (tightest.after ?? 0)) {
      tightest = { checked: true, ceilingGbp: c.totalGbp, source: c.source, before, after, delta, committed };
    }
  }
  return tightest!;
}
