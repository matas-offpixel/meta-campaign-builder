/**
 * Objective-compatibility helpers for the multi-campaign attach flows.
 *
 * `assertSameObjective` detects mixed objectives across attach_all_adsets
 * launches (Phase 0) where one creative-set is distributed across N
 * campaigns. As of task #114 this is informational, not a hard block: the
 * caller in `launch-campaign/route.ts` turns a non-ok result into a
 * non-blocking `preflightWarning` (mixed objectives are an explicitly
 * supported use case — e.g. attaching the same ads across Traffic + Sales +
 * Awareness campaigns) rather than a 409. Any resulting per-ad
 * creative/objective mismatch is caught individually in Phase 4 — see
 * `isObjectiveIncompatibilityError` in `lib/meta/error-classify.ts`.
 */

// Relative + explicit extension: this is a value import, so
// --experimental-strip-types does not erase it.
import {
  importedObjectiveFromAdSetEvents,
  mapMetaObjectiveToInternal,
} from "./campaign.ts";
import type { CampaignObjective, ExistingMetaCampaignSnapshot } from "@/lib/types";

/** Nested on the campaign read. Same edge the importer already uses for the event. */
export const ATTACH_ADSET_VOTE_FIELDS =
  "adsets.limit(50){promoted_object,optimization_goal}";

export interface AttachAdSetVoteRow {
  promoted_object?: {
    custom_event_type?: string | null;
    pixel_id?: string | null;
  } | null;
  optimization_goal?: string | null;
}

export interface AttachCampaignVoteInput {
  objective?: string | null;
  adsets?: {
    data?: AttachAdSetVoteRow[] | null;
    paging?: { next?: string | null } | null;
  } | null;
}

export interface ResolvedAttachObjective {
  objective: CampaignObjective | undefined;
  /**
   * "adsets" only when at least one ad set cast a conversion-event vote.
   * A traffic campaign whose ad sets have no promoted_object stays "campaign".
   */
  objectiveSource: "campaign" | "adsets";
  adSetCount: number;
  /** True when Graph returned paging.next — the vote saw the first 50 only. */
  adSetCountTruncated: boolean;
  minorityEvents: string[];
  /** Human name of the winning conversion event. Absent when nothing voted. */
  conversionEvent: string | null;
  pixelId: string | null;
}

const CHIP_LABEL: Record<CampaignObjective, string> = {
  purchase: "Purchase",
  registration: "Signup",
  initiate_checkout: "Initiate checkout",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

const EVENT_LABEL: Record<string, string> = {
  COMPLETE_REGISTRATION: "Complete registration",
  PURCHASE: "Purchase",
  INITIATED_CHECKOUT: "Initiate checkout",
};

const OBJECTIVE_EVENT_LABEL: Partial<Record<CampaignObjective, string>> = {
  registration: "Complete registration",
  purchase: "Purchase",
  initiate_checkout: "Initiate checkout",
};

export function attachChipLabel(objective: CampaignObjective): string {
  return CHIP_LABEL[objective];
}

export function attachObjectiveChipTitle(
  source: "campaign" | "adsets",
  adSetCount: number,
  truncated = false,
): string {
  if (source !== "adsets" || adSetCount === 0) {
    return adSetCount === 0
      ? "No ad sets yet — from the campaign objective"
      : "From the campaign objective";
  }
  const countLabel = truncated ? "50+" : String(adSetCount);
  const noun = !truncated && adSetCount === 1 ? "ad set's" : "ad sets'";
  return `Resolved from ${countLabel} ${noun} conversion event`;
}

const SALES_FAMILY = new Set([
  "OUTCOME_SALES",
  "CONVERSIONS",
  "PRODUCT_CATALOG_SALES",
  "STORE_VISITS",
]);

/** A sales-family ad set with a conversion event. Traffic and leads do not vote. */
function adSetCastVote(
  rawObjective: string | null | undefined,
  event: string | null | undefined,
): boolean {
  const trimmed = event?.trim() ?? "";
  if (!trimmed) return false;
  const family = (rawObjective ?? "").trim().toUpperCase();
  if (!SALES_FAMILY.has(family)) return false;
  return mapMetaObjectiveToInternal(family, trimmed) != null;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function winningEvent(
  rawObjective: string | null | undefined,
  events: Array<string | null | undefined>,
  objective: CampaignObjective,
): string | null {
  const family = (rawObjective ?? "").trim().toUpperCase();
  if (
    family !== "OUTCOME_SALES" &&
    family !== "CONVERSIONS" &&
    family !== "PRODUCT_CATALOG_SALES" &&
    family !== "STORE_VISITS"
  ) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const raw of events) {
    const event = raw?.trim().toUpperCase() ?? "";
    if (!event) continue;
    if (mapMetaObjectiveToInternal(rawObjective, event) !== objective) continue;
    counts.set(event, (counts.get(event) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [event, count] of counts) {
    if (count > bestCount) {
      best = event;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Sales-family campaigns take their internal objective from the ad sets'
 * conversion event. No ad sets falls back to the campaign objective alone.
 * `OUTCOME_LEADS` ignores the events.
 */
export function resolveAttachCampaign(raw: AttachCampaignVoteInput): ResolvedAttachObjective {
  const rows = raw.adsets?.data ?? [];
  const events = rows.map((row) => row?.promoted_object?.custom_event_type);
  const voted = importedObjectiveFromAdSetEvents(raw.objective, events);
  const objectiveSource = events.some((event) => adSetCastVote(raw.objective, event))
    ? "adsets"
    : "campaign";
  const adSetCountTruncated = Boolean(raw.adsets?.paging?.next);
  const pixelId = mostCommon(
    rows
      .map((row) => row?.promoted_object?.pixel_id?.trim() ?? "")
      .filter((id) => id.length > 0),
  );
  const eventEnum =
    voted.objective && objectiveSource === "adsets"
      ? winningEvent(raw.objective, events, voted.objective)
      : null;
  const conversionEvent = eventEnum ? (EVENT_LABEL[eventEnum] ?? eventEnum) : null;
  return {
    objective: voted.objective,
    objectiveSource,
    adSetCount: rows.length,
    adSetCountTruncated,
    minorityEvents: voted.minorityEvents,
    conversionEvent,
    pixelId,
  };
}

/**
 * Draft objective is the first selected campaign. Compare it only when
 * exactly one campaign is selected. Two or more keep their own voted
 * objectives (#596 / #749) and are listed on the Review line instead.
 */
export function assertAttachSelectionObjectives(input: {
  draftObjective: CampaignObjective;
  selectedCount: number;
  campaigns: Array<{ name: string; resolvedObjective: CampaignObjective }>;
}): { ok: true } | { ok: false; message: string } {
  if (input.selectedCount !== 1) return { ok: true };
  const only = input.campaigns[0];
  if (!only) return { ok: true };
  return assertAttachDraftObjective({
    draftObjective: input.draftObjective,
    campaignName: only.name,
    resolvedObjective: only.resolvedObjective,
  });
}

const LEADS_OBJECTIVES = new Set(["OUTCOME_LEADS", "LEAD_GENERATION"]);

/** Event named on the Review line. Leads have no pixel event, so they read "Lead". */
export function attachCampaignEventLabel(input: {
  conversionEvent?: string | null;
  internalObjective?: CampaignObjective;
  objective?: string | null;
}): string {
  if (input.conversionEvent) return input.conversionEvent;
  const raw = (input.objective ?? "").trim().toUpperCase();
  if (LEADS_OBJECTIVES.has(raw)) return "Lead";
  if (input.internalObjective) return attachChipLabel(input.internalObjective);
  return raw || "Unknown";
}

/** "DAN SHAKE - Signup → Complete registration · GDS Sign up → Lead" */
export function formatAttachMultiCampaignReviewLine(
  campaigns: Array<{
    name: string;
    conversionEvent?: string | null;
    internalObjective?: CampaignObjective;
    objective?: string | null;
  }>,
): string {
  return campaigns
    .map((campaign) => `${campaign.name} → ${attachCampaignEventLabel(campaign)}`)
    .join(" · ");
}

/**
 * One selected campaign against the draft. Mixed campaigns are not compared
 * to each other — attach_all_adsets still allows that.
 */
export function assertAttachDraftObjective(input: {
  draftObjective: CampaignObjective;
  campaignName: string;
  resolvedObjective: CampaignObjective;
}): { ok: true } | { ok: false; message: string } {
  if (input.draftObjective === input.resolvedObjective) return { ok: true };
  const event =
    OBJECTIVE_EVENT_LABEL[input.resolvedObjective] ?? CHIP_LABEL[input.resolvedObjective];
  const draft = CHIP_LABEL[input.draftObjective];
  return {
    ok: false,
    message:
      `${input.campaignName} optimises for ${event}; this draft is set to ${draft}. ` +
      `Change the draft's objective on the Campaign step.`,
  };
}

export type AssertSameObjectiveResult =
  | { ok: true }
  | {
      ok: false;
      campaignA: string;
      campaignB: string;
      objA: string;
      objB: string;
    };

/**
 * Returns `ok: true` when all snapshots share the same raw Meta objective
 * string (e.g. `"LINK_CLICKS"`), or when the list has ≤ 1 entry.
 *
 * On conflict, returns `ok: false` with the first conflicting pair named so
 * the caller can surface a human-readable error:
 *
 * ```
 * "Selected campaigns have incompatible objectives. "{A}" is {objA} while
 * "{B}" is {objB}. Pick campaigns with the same objective and re-try."
 * ```
 */
export function assertSameObjective(
  snaps: ExistingMetaCampaignSnapshot[],
): AssertSameObjectiveResult {
  if (snaps.length <= 1) return { ok: true };
  const first = snaps[0];
  for (let i = 1; i < snaps.length; i++) {
    if (snaps[i].objective !== first.objective) {
      return {
        ok: false,
        campaignA: first.name,
        campaignB: snaps[i].name,
        objA: first.objective,
        objB: snaps[i].objective,
      };
    }
  }
  return { ok: true };
}
