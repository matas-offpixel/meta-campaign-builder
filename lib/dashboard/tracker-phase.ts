/**
 * lib/dashboard/tracker-phase.ts
 *
 * Campaign-phase vocabulary for the Daily Tracker.
 *
 * The tracker collapses everything before `events.general_sale_at`
 * into one row and lists the rest day by day. Until now the collapsed
 * row was called "Presale" regardless of what the campaign actually
 * did, and no row said which day was announce / presale / general
 * sale. A wrong `general_sale_at` therefore looked exactly like a
 * correct one: the table just started a few days early with no hint
 * that the cutoff, not the campaign, moved.
 *
 * Two pure helpers fix that:
 *   - {@link presaleBucketLabel} names the collapsed row after the
 *     phase it covers, using the event's own milestone dates.
 *   - {@link trackerMilestoneDays} maps each milestone to the calendar
 *     day it lands on so the table can mark those rows.
 *
 * Milestones are `timestamptz`. Everything here compares calendar days
 * in the UTC form Postgres hands back, matching the general-sale cutoff
 * the bucket already uses.
 */

export type TrackerMilestoneKind = "announce" | "presale" | "general_sale";

export interface TrackerMilestones {
  announcementAt?: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
}

export const TRACKER_MILESTONE_LABELS: Record<TrackerMilestoneKind, string> = {
  announce: "Announce",
  presale: "Presale",
  general_sale: "Gen sale",
};

export const TRACKER_MILESTONE_TITLES: Record<TrackerMilestoneKind, string> = {
  announce: "events.announcement_at falls on this day",
  presale: "events.presale_at falls on this day",
  general_sale: "events.general_sale_at falls on this day",
};

/** Milestone order as they occur in a campaign. */
const MILESTONE_ORDER: TrackerMilestoneKind[] = [
  "announce",
  "presale",
  "general_sale",
];

function dayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Calendar day → milestones landing on it. Several milestones can
 * share a day (D.O.D opened its community presale at 12:00 and
 * general sale at 14:00 on the same afternoon), so the value is a
 * list kept in campaign order.
 */
export function trackerMilestoneDays(
  milestones: TrackerMilestones | null | undefined,
): Map<string, TrackerMilestoneKind[]> {
  const out = new Map<string, TrackerMilestoneKind[]>();
  if (!milestones) return out;
  const byKind: Record<TrackerMilestoneKind, string | null> = {
    announce: dayOf(milestones.announcementAt),
    presale: dayOf(milestones.presaleAt),
    general_sale: dayOf(milestones.generalSaleAt),
  };
  for (const kind of MILESTONE_ORDER) {
    const day = byKind[kind];
    if (!day) continue;
    const list = out.get(day);
    if (list) list.push(kind);
    else out.set(day, [kind]);
  }
  return out;
}

/** Milestones falling inside an inclusive day range. */
export function trackerMilestonesInRange(
  days: ReadonlyMap<string, TrackerMilestoneKind[]>,
  startDay: string | null,
  endDay: string | null,
): TrackerMilestoneKind[] {
  const found = new Set<TrackerMilestoneKind>();
  for (const [day, kinds] of days) {
    if (startDay && day < startDay) continue;
    if (endDay && day > endDay) continue;
    for (const kind of kinds) found.add(kind);
  }
  return MILESTONE_ORDER.filter((kind) => found.has(kind));
}

/** "27 Aug" — short enough for a range inside a table cell. */
export function fmtShortDay(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return yyyymmdd;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Day before `yyyymmdd`, UTC. */
export function previousDay(yyyymmdd: string): string | null {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface PresaleBucketLabelInput {
  /** Exclusive cutoff the bucket stops at — the general-sale day. */
  cutoffDate: string | null;
  /** First day in the bucket with any activity. */
  earliestDate: string | null;
  milestones?: TrackerMilestones | null;
}

/**
 * Name the collapsed row after the phase it covers.
 *
 * When the event has announce AND presale dates and the bucket stops
 * at general sale, the collapsed row is the signup phase — the part of
 * the campaign that ran on a teaser and a signup form, before a ticket
 * was on sale. Say so, with the days it spans.
 *
 * Without those dates all we honestly know is "everything before
 * general sale", so that is what it says.
 */
export function presaleBucketLabel(input: PresaleBucketLabelInput): string {
  const { cutoffDate, earliestDate, milestones } = input;
  const start = earliestDate ? fmtShortDay(earliestDate) : null;
  const lastDay = cutoffDate ? previousDay(cutoffDate) : null;
  const end = lastDay ? fmtShortDay(lastDay) : null;

  const generalSaleDay = dayOf(milestones?.generalSaleAt);
  const isSignupPhase =
    dayOf(milestones?.announcementAt) !== null &&
    dayOf(milestones?.presaleAt) !== null &&
    generalSaleDay !== null &&
    cutoffDate !== null &&
    generalSaleDay === cutoffDate.slice(0, 10);

  if (isSignupPhase) {
    if (start && end) return `Signup phase (${start} – ${end})`;
    if (end) return `Signup phase (to ${end})`;
    return "Signup phase";
  }

  return start ? `Before general sale (from ${start})` : "Before general sale";
}
