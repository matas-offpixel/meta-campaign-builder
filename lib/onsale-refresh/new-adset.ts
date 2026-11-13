/**
 * The two lines that make a new ad set (design's P3 ruling): an interest
 * cluster brought back, and a missing standing default (retargeting, the
 * registrations lookalike). Pure: the shapes, the budget rule, the
 * targeting each new ad set gets, and the ruled words. Apply
 * (apply-adsets.ts) does the writes.
 *
 * The ruling, in short:
 * - The new ad set is a copy of the campaign's lowest cost-per-result
 *   delivering ad set that has run at least 7 days. It keeps everything
 *   except the audience: a cluster's interests replace the interests; a
 *   default targets its audience only (interests and lookalikes come off,
 *   geography and the 18+ age floor stay). It is never an edit.
 * - Its ads reuse the creative ids of that ad set's delivering ads, at
 *   most 6, no uploads.
 * - Budget: under a campaign budget (CBO) it shares it and adds no spend.
 *   With ad-set budgets (ABO) it takes the copied ad set's daily budget,
 *   from plan headroom first, else moved from the campaign's highest
 *   cost-per-result delivering ad set inside the 20 % cap; neither, and
 *   it can't be accepted.
 * - Registrations come from the pixel only (Lead or CompleteRegistration,
 *   whichever the page fires, read from the event's own ad-days), never an
 *   uploaded list.
 */

import { daysToShow, moveCapLeft, remainingPlan } from "./plan-guard.ts";

export const MIN_COPY_DAYS = 7;
export const MAX_REUSED_CREATIVES = 6;
export const MIN_LOOKALIKE_SEED = 100;

/** Retention windows (design's †defaults; the video one is the builder's mid-funnel preset). */
export const RETENTION = { landing: 30, ticket: 30, video: 60, registrations: 180 } as const;
export const VIDEO_THRESHOLD = 75;
export const LOOKALIKE_RATIO = 0.01;

export type NewAdSetSource = "cluster" | "retargeting" | "registrations_lookalike";

/** The page's signup event on the pixel, read from the event's ad-days; null when they show none. */
export type SignupEvent = "CompleteRegistration" | "Lead";

export type Funding =
  | { mode: "cbo" }
  | { mode: "headroom"; dailyGbp: number }
  | { mode: "move"; dailyGbp: number; fromAdsetId: string; fromName: string }
  | { mode: "none" };

export type CopySource = { adsetId: string; name: string; cprGbp: number | null; resultLabel: string; dailyGbp: number; creatives: number };

export type Giver = { adsetId: string; name: string };

export const NO_BUDGET_TO_START = "No budget to start it: set this event's budget, or there's nothing left to move this refresh.";
export const NO_COPY_SOURCE = "No delivering ad set has run 7 days yet, so there's nothing to copy.";
export const SIGNUP_NOT_READ = "This show's ads haven't recorded a signup on the pixel yet, so there are no registrations to build from.";

export function seedTooSmall(n: number): string {
  return `Too few registrations for a lookalike yet: ${n} of ${MIN_LOOKALIKE_SEED}.`;
}

const gbp = (value: number) => `£${value.toFixed(2)}`;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * R5 for a new ad set. CBO: shares the campaign budget. ABO: the copied
 * set's daily budget for each day left must fit the plan's headroom; else
 * a move of that daily budget (a week of it counts against the cap) from
 * the giver; else none.
 */
export function decideFunding(args: {
  budgetLevel: "campaign" | "ad_set" | null;
  dailyGbp: number;
  budget: number | null;
  spend: number;
  today: string;
  eventDate: string | null;
  appliedMovesGbp: number;
  giver: Giver | null;
}): Funding {
  if (args.budgetLevel === "campaign") return { mode: "cbo" };
  const remaining = remainingPlan(args.budget, args.spend);
  if (remaining == null || args.dailyGbp <= 0) return { mode: "none" };
  const daily = round2(args.dailyGbp);
  if (daily * daysToShow(args.today, args.eventDate) <= remaining) return { mode: "headroom", dailyGbp: daily };
  const cap = moveCapLeft(args.budget, args.spend, args.appliedMovesGbp);
  if (args.giver && cap && daily * 7 <= cap.left + 0.005) return { mode: "move", dailyGbp: daily, fromAdsetId: args.giver.adsetId, fromName: args.giver.name };
  return { mode: "none" };
}

/** `{budget}` in the write line. */
export function budgetText(funding: Funding): string {
  if (funding.mode === "cbo") return "shares the campaign budget";
  if (funding.mode === "headroom") return `${gbp(funding.dailyGbp)} a day from plan headroom`;
  if (funding.mode === "move") return `${gbp(funding.dailyGbp)} a day moved from ${funding.fromName}`;
  return "no budget yet";
}

/** A week of a moved daily budget: what counts against the 20 % cap. */
export function weeklyMoved(funding: Funding): number {
  return funding.mode === "move" ? round2(funding.dailyGbp * 7) : 0;
}

// ── Words (design's ruling) ──────────────────────────────────────────────────

export function clusterEvidence(index: number, confidence: string): string {
  return `Interest cluster · index ${index} · confidence ${confidence} · not on this event`;
}

export function interestsLine(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return `Interests: ${shown.join(", ")}${more > 0 ? ` +${more}` : ""}`;
}

export function clusterNarrow(index: number, n: number): string {
  return `Cluster · index ${index} · ${n} interest${n === 1 ? "" : "s"}`;
}

export function clusterWrite(copy: CopySource, funding: Funding): string {
  const cpr = copy.cprGbp == null ? "" : ` (${gbp(copy.cprGbp)} per ${copy.resultLabel})`;
  return `New ad set: a copy of ${copy.name}${cpr} with these interests · ${copy.creatives} creative${copy.creatives === 1 ? "" : "s"} reused · ${budgetText(funding)} · goes in live`;
}

export function newAdSetNarrowWrite(copy: CopySource, funding: Funding): string {
  return `New ad set from ${copy.name} · ${budgetText(funding)} · live`;
}

export function defaultWhy(which: "retargeting" | "registrations_lookalike"): string {
  return which === "retargeting" ? "This campaign has no retargeting ad set." : "The registrations lookalike isn't in its own ad set.";
}

export function retargetingEvidence(counts: { landing: number | null; ticket: number | null; registrations: number | null }): string {
  const parts: string[] = [];
  if (counts.landing != null) parts.push(`landing-page visitors ${counts.landing}`);
  if (counts.ticket != null) parts.push(`ticket-link visitors ${counts.ticket}`);
  parts.push("video viewers");
  if (counts.registrations != null) parts.push(`registrations ${counts.registrations}`);
  return `Builds one audience: ${parts.join(" · ")} (our counts, last 30–180 days)`;
}

export function lookalikeEvidence(seed: number, country: string): string {
  return `Seed: ${seed} registrations on the pixel · 1 % lookalike in ${country}`;
}

export function defaultWrite(copy: CopySource, funding: Funding): string {
  return `New audience and ad set: a copy of ${copy.name} aimed at this audience only · ${copy.creatives} creative${copy.creatives === 1 ? "" : "s"} reused · ${budgetText(funding)} · goes in live`;
}

export function defaultNarrowWrite(copy: CopySource, funding: Funding): string {
  return `New audience and ad set from ${copy.name} · ${budgetText(funding)} · live`;
}

/** The new ad set's name († design's default). */
export function newAdSetName(source: NewAdSetSource, code: string | null, clusterName?: string): string {
  const prefix = code ? `[${code}] ` : "";
  if (source === "cluster") return `${prefix}${clusterName ?? "Interest cluster"}`;
  return source === "retargeting" ? `${prefix}Retargeting` : `${prefix}Registrations lookalike 1%`;
}

/** F3. */
export function appliedNewAdSet(source: NewAdSetSource, ads: number, retired: readonly string[] = []): string {
  const made = source === "cluster" ? `new ad set live, ${ads} ad${ads === 1 ? "" : "s"}` : `audience made, new ad set live, ${ads} ad${ads === 1 ? "" : "s"}`;
  return retired.length ? `${made}. Left out, no longer offered by Meta: ${retired.join(", ")}.` : made;
}

export function partialNewAdSet(k: number, n: number, reason: string): string {
  return `Ad set live · ${k} of ${n} ads — ${reason}`;
}

export const AUDIENCE_BUILDING = "Meta didn't take this — the audience is still being built. Retry in a few hours.";
export const AUDIENCE_TOO_SMALL = "Meta didn't take this — the audience is too small to deliver.";
export const ALL_INTERESTS_RETIRED = "Meta didn't take this — none of the cluster's interests are offered any more.";

// ── Targeting (never an edit: these build the new ad set's from the copied one) ──

type Targeting = Record<string, unknown>;

const INTEREST_KEYS = ["interests", "behaviors", "life_events", "industries", "income", "family_statuses", "user_adclusters", "work_positions", "work_employers", "education_schools", "education_majors"];

/** A cluster: everything kept, the interests replaced by the cluster's. */
export function clusterTargeting(source: Targeting, interests: readonly { id: string; name: string }[]): Targeting {
  const next: Targeting = structuredClone(source);
  delete next.interests;
  const flex = Array.isArray(next.flexible_spec) ? (next.flexible_spec as Record<string, unknown>[]) : [];
  const kept = flex
    .map((entry) => {
      const copy = { ...entry };
      delete copy.interests;
      return copy;
    })
    .filter((entry) => Object.keys(entry).length > 0);
  next.flexible_spec = [...kept, { interests: interests.map((interest) => ({ id: interest.id, name: interest.name })) }];
  return next;
}

/** A standing default: aimed at its audiences only. Interests and lookalikes come off; geography, placements, exclusions and the 18+ age floor stay. */
export function audienceOnlyTargeting(source: Targeting, audienceIds: readonly string[]): Targeting {
  const next: Targeting = structuredClone(source);
  delete next.flexible_spec;
  for (const key of INTEREST_KEYS) delete next[key];
  next.custom_audiences = audienceIds.map((id) => ({ id }));
  next.age_min = Math.max(18, Number(source.age_min) || 18);
  // Advantage+ audience would widen past the audience; the default is the audience only.
  if (next.targeting_automation && typeof next.targeting_automation === "object") next.targeting_automation = { ...(next.targeting_automation as Record<string, unknown>), advantage_audience: 0 };
  return next;
}

/** The fields copied from the source ad set into the new one (schedule, optimisation, attribution, placements via targeting). */
export const COPIED_FIELDS = ["optimization_goal", "billing_event", "bid_strategy", "bid_amount", "promoted_object", "attribution_spec", "destination_type", "end_time", "pacing_type"] as const;

/** Lowest cost per result among delivering ad sets live at least 7 days. */
export function pickCopySource<T extends { adsetId: string; name: string; delivering: boolean; firstDay: string; weekSpend: number; weekResults: number }>(sets: readonly T[], windowEnd: string): T | null {
  const days = (from: string) => Math.round((Date.parse(`${windowEnd}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  return (
    sets
      .filter((set) => set.delivering && days(set.firstDay) >= MIN_COPY_DAYS && set.weekResults > 0)
      .sort((a, b) => a.weekSpend / a.weekResults - b.weekSpend / b.weekResults)[0] ?? null
  );
}

/** Highest cost per result among delivering ad sets, other than the copied one: where an ABO new ad set's money comes from. */
export function pickGiver<T extends { adsetId: string; name: string; delivering: boolean; weekSpend: number; weekResults: number }>(sets: readonly T[], except: string): T | null {
  const cpr = (set: T) => (set.weekResults > 0 ? set.weekSpend / set.weekResults : Number.POSITIVE_INFINITY);
  return sets.filter((set) => set.delivering && set.adsetId !== except && set.weekSpend > 0).sort((a, b) => cpr(b) - cpr(a))[0] ?? null;
}
