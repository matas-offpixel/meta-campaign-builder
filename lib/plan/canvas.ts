/**
 * The canvas view model — §2 of the campaign-creator redesign.
 *
 * One screen, seven zones, one button. This module answers the question
 * the canvas exists to answer ("is this ready to launch, and if not what
 * is the one thing in the way?") as pure data, so the component renders
 * and does not decide.
 */

import { channelRowState, type ChannelFact, type ChannelRowState } from "../viz/channel-row.ts";
import { statusFromLaunchAndBlockers } from "../viz/status.ts";
import type { BlockerAnchor, BlockerRowModel } from "../viz/blockers.ts";
import { collectBadgeRows } from "../viz/blockers.ts";
import type { VizPlatform, VizStatus } from "../viz/tokens.ts";
import type { PlanAdsManagerLink } from "./ads-manager-links.ts";
import { splitPlanBlockers } from "./blockers.ts";
import type { PlanPreflightIssue } from "./preflight.ts";
import { budgetedLaunchAdapters, type CampaignPlan, type PlanAdapterName } from "./types.ts";

/**
 * Drawer landing sections. PR 4 turns `ChannelRow.anchor` into an actual
 * drawer open; every row and blocker already carries one so that flip is
 * a router change, not a re-mapping.
 */
export const PLAN_DRAWER_SECTIONS = {
  meta: ["f-audiences", "f-creatives", "f-adsets"],
  tiktok: ["tt-video", "tt-refine"],
  google: ["g-keywords", "g-copy"],
} as const satisfies Record<VizPlatform, readonly string[]>;

export type PlanDrawerSection =
  (typeof PLAN_DRAWER_SECTIONS)[VizPlatform][number];

/** The section a row opens at when nothing more specific is known. */
export function defaultAnchorFor(adapter: PlanAdapterName): BlockerAnchor {
  return { drawer: adapter, section: PLAN_DRAWER_SECTIONS[adapter][0] };
}

/**
 * Preflight `field` → drawer section, keyed by adapter because the
 * vocabularies collide: `creatives` means the Feed creative list on Meta
 * and the video slot on TikTok. Unmapped fields land on the drawer's
 * first section rather than nowhere — a blocker that opens the wrong
 * section is recoverable, one that opens nothing is not.
 */
const FIELD_SECTIONS: Record<VizPlatform, Record<string, PlanDrawerSection>> = {
  meta: {
    creative: "f-creatives",
    creatives: "f-creatives",
    audience: "f-audiences",
    audiences: "f-audiences",
    adset: "f-adsets",
    adsets: "f-adsets",
    budget: "f-adsets",
  },
  tiktok: {
    video: "tt-video",
    creative: "tt-video",
    creatives: "tt-video",
    identity: "tt-refine",
    budget: "tt-refine",
  },
  google: {
    keyword: "g-keywords",
    keywords: "g-keywords",
    negative: "g-keywords",
    negatives: "g-keywords",
    rsa: "g-copy",
    ad_copy: "g-copy",
    headline: "g-copy",
    description: "g-copy",
  },
};

export function anchorForIssue(issue: PlanPreflightIssue): BlockerAnchor {
  const section = FIELD_SECTIONS[issue.adapter][issue.field];
  if (section && PLAN_DRAWER_SECTIONS[issue.adapter].some((id) => id === section)) {
    return { drawer: issue.adapter, section };
  }
  return defaultAnchorFor(issue.adapter);
}

export interface PlanChannelRowModel {
  adapter: PlanAdapterName;
  status: VizStatus;
  state: ChannelRowState;
  facts: ChannelFact[];
  derived: boolean;
  waiting: boolean;
  waitingFor: VizPlatform;
  blockers: BlockerRowModel[];
  /** Where a row click lands once PR 4 replaces the wizard href. */
  anchor: BlockerAnchor;
  /** Parity during migration — the wizard route for the linked draft. */
  href: string | null;
  /** TikTok / Google `▷` is disabled, so the platform's own UI is the cure. */
  adsManagerHref: string | null;
  draftId: string | null;
  /** Zero daily budget: preflight skips it, so the row is off, not blocked. */
  skipped: boolean;
  staleChip: string | null;
}

export interface PlanChannelFactsBundle {
  meta: ChannelFact[];
  tiktok: ChannelFact[];
  google: ChannelFact[];
}

/**
 * One row per platform. `derived` is true for TikTok and Google because
 * their vocabulary comes out of the Meta draft, never authored first.
 */
export function planChannelRows(input: {
  plan: CampaignPlan;
  issues: PlanPreflightIssue[];
  facts: PlanChannelFactsBundle;
  hrefs: Partial<Record<PlanAdapterName, string | null>>;
  /**
   * The escape hatch for the two platforms this app cannot resume. A row
   * without a link is a row with nothing on the platform yet.
   */
  adsManagerLinks?: readonly PlanAdsManagerLink[];
  staleChips?: Partial<Record<PlanAdapterName, string | null>>;
  /**
   * True once the event's rollups show spend. Fan-out creates every
   * entity PAUSED, so a launch record saying `live` means "created" —
   * delivery is the only honest evidence that it is actually running.
   */
  delivering?: boolean;
}): PlanChannelRowModel[] {
  const hasMetaDraft = input.plan.launches.meta.draftId != null;
  const budgeted = new Set(budgetedLaunchAdapters(input.plan.intent.budget));

  return (["meta", "tiktok", "google"] as const).map((adapter) => {
    const record = input.plan.launches[adapter];
    const split = splitPlanBlockers(input.issues, adapter);
    const blocking = [...split.wizard, ...split.plan];
    const skipped = !budgeted.has(adapter);
    const waiting = adapter !== "meta" && !hasMetaDraft;
    /**
     * `collectBadgeRows` dedupes and reorders, so the anchor is looked up
     * by message rather than by index — pairing on position would send
     * PR 4's drawer to the wrong section the first time two issues
     * collapse into one row.
     */
    const byMessage = new Map(
      [...blocking, ...split.notes].map((issue) => [issue.message, issue]),
    );
    const blockers = skipped
      ? []
      : collectBadgeRows(
          blocking.map((issue) => ({
            id: issue.id,
            message: issue.message,
            href: issue.href,
          })),
          split.notes.map((issue) => ({ id: issue.id, message: issue.message })),
        ).map((row) => {
          const issue = byMessage.get(row.full);
          return {
            ...row,
            anchor: issue ? anchorForIssue(issue) : defaultAnchorFor(adapter),
          };
        });

    /** Advisories ride the same badge but must not recolour the dot. */
    const blockerCount = blockers.filter((row) => row.kind === "blocker").length;
    const base = statusFromLaunchAndBlockers(record, blockerCount);
    const status: VizStatus =
      record.platformCampaignId != null && !input.delivering ? "paused" : base;
    return {
      adapter,
      status,
      state: channelRowState({ status, waiting, blocked: blockerCount > 0 }),
      facts: input.facts[adapter],
      derived: adapter !== "meta",
      waiting,
      waitingFor: "meta" as VizPlatform,
      blockers,
      anchor: defaultAnchorFor(adapter),
      href: input.hrefs[adapter] ?? null,
      adsManagerHref:
        input.adsManagerLinks?.find((link) => link.adapter === adapter)?.href ?? null,
      draftId: record.draftId,
      skipped,
      staleChip: input.staleChips?.[adapter] ?? null,
    };
  });
}

/**
 * §2's four states plus `waiting` — the honest fifth, for a plan with no
 * Meta draft yet, where "blocked" would overstate what is wrong.
 */
export type PlanCanvasState = "waiting" | "blocked" | "ready" | "launched" | "live";

/**
 * `launched` and `live` are the same plan rows; delivery is what tells
 * them apart. Fan-out always creates entities PAUSED, so a plan whose
 * launches carry platform ids is LAUNCHED until spend appears. Reading
 * spend from `event_daily_rollups` (already summed for the funnel) keeps
 * this honest without a `resumed_at` column or a live Meta read.
 */
export function planCanvasState(input: {
  plan: CampaignPlan;
  rows: PlanChannelRowModel[];
  /** Lifetime spend across the event's rollups. Zero / null = not delivering. */
  liveSpend?: number | null;
}): PlanCanvasState {
  const active = input.rows.filter((row) => !row.skipped);
  const launched =
    active.length > 0 &&
    active.some((row) => input.plan.launches[row.adapter].platformCampaignId != null);
  if (launched) return (input.liveSpend ?? 0) > 0 ? "live" : "launched";
  if (!input.plan.launches.meta.draftId) return "waiting";
  if (active.some((row) => row.blockers.length > 0)) return "blocked";
  return active.length > 0 ? "ready" : "waiting";
}

export interface PlanLaunchButtonModel {
  /**
   * `⏸ Launch`, `▷ Resume 3` once something is paused on-platform, or
   * `none` when a delivering plan has nothing left to press.
   */
  kind: "launch" | "resume" | "none";
  label: string;
  disabled: boolean;
  /** Non-null whenever a rendered button is disabled — never a dead button. */
  reason: string | null;
  resumeCount: number;
}

export function planLaunchButton(input: {
  state: PlanCanvasState;
  rows: PlanChannelRowModel[];
  gateEnabled: boolean;
  gateReason?: string | null;
  hasEvent: boolean;
  hasDestination: boolean;
  preflightOk: boolean;
  busy: boolean;
}): PlanLaunchButtonModel {
  if (input.state === "launched" || input.state === "live") {
    const resumable = input.rows.filter(
      (row) => !row.skipped && row.status === "paused",
    ).length;
    /**
     * A fully-delivering plan gets no button at all rather than a
     * disabled `▷ Resume 0`. There is nothing to press, and the funnel
     * stack under it is the answer the operator came for.
     */
    if (resumable === 0) {
      return {
        kind: "none",
        label: "",
        disabled: true,
        reason: null,
        resumeCount: 0,
      };
    }
    return {
      kind: "resume",
      label: `▷ Resume ${resumable}`,
      disabled: input.busy || !input.gateEnabled,
      reason: !input.gateEnabled
        ? (input.gateReason ?? PLAN_CANVAS_COPY.fanoutOff)
        : input.busy
          ? PLAN_CANVAS_COPY.launchBusy
          : null,
      resumeCount: resumable,
    };
  }

  const reason = !input.gateEnabled
    ? (input.gateReason ?? PLAN_CANVAS_COPY.fanoutOff)
    : !input.hasEvent
      ? PLAN_CANVAS_COPY.noEvent
      : !input.hasDestination
        ? PLAN_CANVAS_COPY.noDestination
        : !input.preflightOk
          ? PLAN_CANVAS_COPY.blockers
          : input.busy
            ? PLAN_CANVAS_COPY.launchBusy
            : null;
  return {
    kind: "launch",
    label: "⏸ Launch",
    disabled: reason != null,
    reason,
    resumeCount: 0,
  };
}

/**
 * Resume is a status write, and only Meta has one in this app. TikTok and
 * Google rows show `▷` disabled with the reason rather than a button that
 * silently does nothing.
 */
export function resumeSupport(adapter: PlanAdapterName): {
  supported: boolean;
  reason: string | null;
} {
  return adapter === "meta"
    ? { supported: true, reason: null }
    : { supported: false, reason: PLAN_CANVAS_COPY.resumeElsewhere };
}

/**
 * Zone A's `⋯`. Everything that used to be a button on the plan page and
 * is not one of the three adjustable inputs, the seven zones, or the one
 * launch — §2's "everything else is a badge" needs somewhere for the
 * verbs to go.
 */
export function planCanvasMenuItemSpecs(input: {
  status: CampaignPlan["status"];
  disposal: "delete" | "archive";
  hasMetaDraft: boolean;
  unregisteredAssets: number;
}): Array<{ id: string; label: string; hidden?: boolean; destructive?: boolean }> {
  return [
    { id: "from-existing", label: "From existing campaign…", hidden: input.hasMetaDraft },
    {
      id: "register-assets",
      label: `Register ${input.unregisteredAssets} existing assets`,
      hidden: input.unregisteredAssets <= 0,
    },
    { id: "duplicate", label: "Duplicate" },
    { id: "template", label: "Save as plan template" },
    { id: "unarchive", label: "Unarchive", hidden: input.status !== "archived" },
    {
      id: "delete",
      label: input.disposal === "delete" ? "Delete plan" : "Archive plan",
      destructive: true,
    },
  ];
}

/**
 * `◐ n ▸` — decisions the operator has not seen. "Last opened" is a
 * local fact about one person's browser, so it lives in `localStorage`
 * and needs no column.
 */
export function planLastOpenedKey(planId: string): string {
  return `plan:last-opened:${planId}`;
}

export function countDecisionsSince(
  decisions: ReadonlyArray<{ decidedAt?: string | null }>,
  lastOpenedAt: string | null,
): number {
  if (!lastOpenedAt) return decisions.length;
  return decisions.filter(
    (decision) => (decision.decidedAt ?? "") > lastOpenedAt,
  ).length;
}

/** Absent at zero (§2 table row A) — a zero badge is furniture. */
export function decisionsHandleLabel(count: number): string | null {
  return count > 0 ? `◐ ${count} ▸` : null;
}

/**
 * Every sentence the canvas can show, in one place. §6 puts explanation
 * in an `InfoTip`; keeping the strings here also keeps them out of the
 * components the grep-guard scans for long literals.
 */
export const PLAN_CANVAS_COPY = {
  fanoutOff: "Launch is off — ENABLE_PLAN_FANOUT is not \"1\".",
  noEvent: "Choose an event first.",
  noDestination:
    "No destination — this event has no ticket_url or signup_url. Paste one in the ⓘ.",
  blockers: "Preflight still has blockers.",
  launchBusy: "Launch in progress.",
  nothingPaused: "Nothing paused to resume.",
  resumeElsewhere: "Resume in Ads Manager — this app writes status on Meta only.",
  destination:
    "Destination comes from the event. Change it on the event, not the plan.",
  decisions: "Automation decisions since you last opened this plan.",
  unitChangesObjective:
    "The unit sets the objective: preflight re-runs and the client preset re-resolves.",
  unitInferred:
    "This unit is read from the plan's objective — tap one to store it on the plan.",
  noUnit:
    "Engagement has no cost-per unit, so the objective is picked directly here.",
  targetSeed: "No target set — this is the client preset's benchmark.",
  splitZeroIsOff: "A platform at 0% is skipped at launch.",
  derive: "TikTok and Google are derived from the Meta draft, never authored first.",
  window: "Start defaults to now plus a 15-minute buffer so Meta never sees a past start.",
  assetsRegister: "Register assets already on the linked Meta draft.",
} as const;
