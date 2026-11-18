/**
 * RT17 — test both layouts (docs/design-record/2026-11-17-retargeting-campaign-2.html),
 * with ops' ruling on the start (option (c), 17 Nov).
 *
 *   - Arm A is RT14's layout (tiers by action); arm B is J2's recency
 *     layout: every source in every tier, Bottom at 30 days (plus A's
 *     high-intent actions at A's windows and the Signups lists), Mid Bottom
 *     at 60 (plus the Similar lists), Mid at 180. Each tier leaves out the
 *     hotter tiers and buyers.
 *   - Each arm gets half the show's total, split 50 / 25 / 25 inside the arm
 *     with RT4's £1.00 floor. A show under £6.00 a day isn't entered: one
 *     campaign on layout A (then on the winner).
 *   - One Meta A/B test (ad study) per show holds the two campaigns as 50 %
 *     cells. Ops (c): the arms are made under the one Accept with every ad
 *     set's start_time at the test's start, 00:00 in the ad account's
 *     timezone on the earliest allowed day (tomorrow), then the study with
 *     that start. Nothing delivers before the split.
 *   - The call is pooled: each arm's spend ÷ its attributed purchases summed
 *     across shows, never averaged show by show, made only at 14 days, 30
 *     attributed purchases per arm, 3 shows and 15 % cheaper (CT7). From 28
 *     days, still under 15 %: "No clear winner …", accepting keeps A.
 *
 * Pure.
 */

import { landingLinks, ticketLinks } from "./links.ts";
import { tierSpecs, usablePages, type SourceSet, type TierAudience, type TierSpec } from "./audiences.ts";
import type { Arm, Tier } from "./words.ts";

export const RT17 = {
  /** A show under this total a day isn't entered. */
  entryFloorMinor: 600,
  callDays: 14,
  minPurchasesPerArm: 30,
  minShows: 3,
  /** CT7's margin: the cheaper arm at least 15 % cheaper. */
  margin: 0.15,
  fallbackDays: 28,
  floorMinor: 100,
} as const;

// ── Arm B's audiences ────────────────────────────────────────────────────────

const B_WINDOWS: Record<Tier, number> = { bottom: 30, mid_bottom: 60, mid: 180 };

/** RT17 arm B: every source in every tier at the tier's window, plus Bottom's high-intent actions at A's windows and the lists. Keys start "b:". */
export function recencySpecs(set: SourceSet, opts: { bottom?: boolean } = {}): TierSpec[] {
  const tickets = ticketLinks(set.links).map((link) => link.rule);
  const landing = landingLinks(set.links).map((link) => link.rule);
  const allPages = usablePages(set.pages);
  const igPages = allPages.filter((page) => page.igId).map((page) => page.id);
  const every = (tier: Tier): TierAudience[] => {
    const days = B_WINDOWS[tier];
    const out: TierAudience[] = [];
    if (set.pixelId) {
      if (tickets.length) {
        out.push({ key: `b:${tier}:ticket:${days}`, kind: "pixel_url", label: "Ticket-link visitors", pixelId: set.pixelId, urlContains: tickets, retentionDays: days });
        out.push({ key: `b:${tier}:checkout:${days}`, kind: "pixel_event", label: "Checkout starters", pixelId: set.pixelId, pixelEvent: "InitiateCheckout", urlContains: tickets, retentionDays: days });
      }
      if (landing.length) {
        out.push({ key: `b:${tier}:page:${days}`, kind: "pixel_url", label: "Page visitors", pixelId: set.pixelId, urlContains: landing, retentionDays: days });
        out.push({ key: `b:${tier}:registrations:${days}`, kind: "pixel_event", label: "Registrations", pixelId: set.pixelId, pixelEvent: "CompleteRegistration", urlContains: landing, retentionDays: days });
      }
    }
    // Video at 75 % in every B tier, one set per page (RT17's invented-here).
    for (const group of set.videos) out.push({ key: `b:${tier}:video:${group.contextId}:${days}`, kind: "video", label: `Video viewers 75 % · ${set.pages.find((page) => page.id === group.contextId)?.name ?? group.contextId}`, contextId: group.contextId, videoIds: group.videoIds.slice(0, 200), threshold: 75, retentionDays: days });
    if (allPages.length) out.push({ key: `b:${tier}:fb:${days}`, kind: "page_fb", label: "Page engagers", pageIds: allPages.slice(0, 5).map((page) => page.id), retentionDays: days });
    if (igPages.length) out.push({ key: `b:${tier}:ig:${days}`, kind: "page_ig", label: "Instagram engagers", pageIds: igPages.slice(0, 5), retentionDays: days });
    return out;
  };
  const bottom = every("bottom");
  // A's high-intent actions at A's windows: registrations to 180 days (the 30-day one is already there).
  if (set.pixelId && landing.length) for (const days of [90, 180]) bottom.push({ key: `b:bottom:registrations:${days}`, kind: "pixel_event", label: "Registrations", pixelId: set.pixelId, pixelEvent: "CompleteRegistration", urlContains: landing, retentionDays: days });
  for (const list of set.lists) if (list.role === "signups") bottom.push({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: list.role });
  const midBottom = every("mid_bottom");
  for (const list of set.lists) if (list.role === "similar") midBottom.push({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: list.role });
  const mid = every("mid");
  const buyers: TierAudience[] = set.lists.filter((list) => list.role === "buyers").map((list) => ({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: "buyers" }));
  const hot = opts.bottom === false ? [] : bottom;
  const specs: TierSpec[] = [];
  if (hot.length) specs.push({ tier: "bottom", includes: hot, excludes: [...buyers] });
  if (midBottom.length) specs.push({ tier: "mid_bottom", includes: midBottom, excludes: [...hot, ...buyers] });
  if (mid.length) specs.push({ tier: "mid", includes: mid, excludes: [...midBottom, ...hot, ...buyers] });
  return specs;
}

/** An arm's tier specs. */
export function armSpecs(arm: Arm, set: SourceSet, opts: { bottom?: boolean } = {}): TierSpec[] {
  return arm === "A" ? tierSpecs(set, opts) : recencySpecs(set, opts);
}

// ── Money ────────────────────────────────────────────────────────────────────

/** RT17: entered when the show's total is £6.00 a day or more. */
export function entered(totalMinor: number): boolean {
  return totalMinor >= RT17.entryFloorMinor;
}

/** RT17: each arm's tiers — half the total, split 50 / 25 / 25 to the penny (odd penny to Bottom), the floor per tier taken out of Bottom. */
export function armTiers(totalMinor: number, opts: { floorMinor?: number; midBuildable?: boolean; bottomBuildable?: boolean } = {}): { halfMinor: number; tiers: Record<Tier, number> } {
  const floor = Math.max(RT17.floorMinor, opts.floorMinor ?? 0);
  const half = Math.floor(totalMinor / 2);
  const lift = (value: number) => Math.max(floor, value);
  if (opts.bottomBuildable === false) {
    const mid = opts.midBuildable === false ? 0 : lift(Math.floor(half / 2));
    return { halfMinor: half, tiers: { bottom: 0, mid_bottom: lift(half - mid), mid } };
  }
  const midBottom = lift(opts.midBuildable === false ? Math.floor(half / 3) : Math.floor(half / 4));
  const mid = opts.midBuildable === false ? 0 : lift(Math.floor(half / 4));
  return { halfMinor: half, tiers: { bottom: lift(half - midBottom - mid), mid_bottom: midBottom, mid } };
}

// ── The start ────────────────────────────────────────────────────────────────

/** The offset of an IANA timezone from UTC at an instant, in minutes. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The ad account's local date for an instant (YYYY-MM-DD). */
export function localDay(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * Ops (c): the test starts at 00:00 in the ad account's timezone on the
 * earliest allowed day, tomorrow there. Returns the instant and its local day.
 */
export function testStart(timeZone: string, now: Date): { at: Date; day: string } {
  const today = localDay(timeZone, now);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const midnightUtc = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  // 00:00 local = 00:00 UTC minus the offset in force then (checked twice across a clock change).
  let at = new Date(midnightUtc - offsetMinutes(timeZone, new Date(midnightUtc)) * 60_000);
  at = new Date(midnightUtc - offsetMinutes(timeZone, at) * 60_000);
  return { at, day: localDay(timeZone, at) };
}

/** Meta's ad-set start_time: ISO 8601 with offset. */
export function metaTime(at: Date): string {
  return `${at.toISOString().slice(0, 19)}+0000`;
}

/** The study's payload: POST /{business_id}/ad_studies, two 50 % cells, one campaign each. */
export function studyPayload(args: { code: string; campaignA: string; campaignB: string; start: Date; end: Date }): Record<string, unknown> {
  return {
    name: `${args.code} · Retargeting · A/B test`,
    description: "Retargeting layouts: A tiers by action, B by recency (RT17).",
    type: "SPLIT_TEST",
    start_time: Math.floor(args.start.getTime() / 1000),
    end_time: Math.floor(args.end.getTime() / 1000),
    cells: JSON.stringify([
      { name: "A · tiers by action", treatment_percentage: 50, campaigns: [args.campaignA] },
      { name: "B · by recency", treatment_percentage: 50, campaigns: [args.campaignB] },
    ]),
  };
}

// ── The pooled call ──────────────────────────────────────────────────────────

export type ArmTotals = { shows: number; spend: number; purchases: number; cost: number | null };

export type PooledRead = {
  /** The first show's test start (YYYY-MM-DD) and the read's last day. */
  from: string;
  to: string;
  days: number;
  shows: number;
  arms: Record<Arm, ArmTotals>;
};

/** Pooled per arm: spend and attributed purchases summed across shows (never averaged show by show). */
export function pooled(rows: readonly { show: string; arm: Arm; date: string; spend: number; purchases: number }[], args: { from: string; to: string }): PooledRead {
  const within = rows.filter((row) => row.date >= args.from && row.date <= args.to);
  const totals = (arm: Arm): ArmTotals => {
    const mine = within.filter((row) => row.arm === arm);
    const spend = Math.round(mine.reduce((sum, row) => sum + row.spend, 0) * 100) / 100;
    const purchases = mine.reduce((sum, row) => sum + row.purchases, 0);
    return { shows: new Set(mine.map((row) => row.show)).size, spend, purchases, cost: purchases > 0 ? Math.round((spend / purchases) * 100) / 100 : null };
  };
  const days = Math.round((Date.parse(`${args.to}T12:00:00Z`) - Date.parse(`${args.from}T12:00:00Z`)) / 86_400_000) + 1;
  return { from: args.from, to: args.to, days, shows: new Set(within.map((row) => row.show)).size, arms: { A: totals("A"), B: totals("B") } };
}

export type CallState =
  | { kind: "not_yet"; day: number; a: number; b: number; shows: number }
  | { kind: "too_close"; a: number; b: number; pct: number }
  | { kind: "no_clear_winner"; a: number; b: number }
  | { kind: "call"; winner: Arm; x: number; nx: number; y: number; ny: number; pct: number; shows: number; days: number; from: string; to: string };

/** RT17's call from the pooled read. The margin shows rounded down ("22 % (22.4 %)"). */
export function callFor(read: PooledRead): CallState {
  const { A, B } = read.arms;
  if (read.days < RT17.callDays || A.purchases < RT17.minPurchasesPerArm || B.purchases < RT17.minPurchasesPerArm || read.shows < RT17.minShows || A.cost == null || B.cost == null) {
    return { kind: "not_yet", day: read.days, a: A.purchases, b: B.purchases, shows: read.shows };
  }
  const winner: Arm = A.cost <= B.cost ? "A" : "B";
  const x = winner === "A" ? A : B;
  const y = winner === "A" ? B : A;
  const exact = 1 - x.cost! / y.cost!;
  const pct = Math.floor(exact * 100 + 1e-9);
  if (exact + 1e-9 < RT17.margin) {
    return read.days >= RT17.fallbackDays ? { kind: "no_clear_winner", a: A.cost, b: B.cost } : { kind: "too_close", a: A.cost, b: B.cost, pct };
  }
  return { kind: "call", winner, x: x.cost!, nx: x.purchases, y: y.cost!, ny: y.purchases, pct, shows: read.shows, days: read.days, from: read.from, to: read.to };
}
