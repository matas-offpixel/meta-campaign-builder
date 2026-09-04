/**
 * Drawer model — pure. The Meta drawer's tabs, the section a row or a
 * blocker lands on, the URL that survives a refresh, and the `details`
 * rows at the drawer's foot.
 *
 * Nothing here imports React or `@/`, so the whole model is testable
 * under `node --test` the way the canvas model is.
 */

import type { BlockerAnchor, BlockerRowModel } from "../viz/blockers.ts";
import type { VizPlatform, VizProvenance } from "../viz/tokens.ts";
import type { PlanDrawerSection } from "./canvas.ts";
import type { PlanAdapterName } from "./types.ts";

// ── tabs ───────────────────────────────────────────────────────────────

/**
 * One tab per section, in the order the redesign requires: audiences
 * before ad sets, because the ad-set suggestions read the audiences and
 * that is the one hard dependency left in the Meta flow (§5 row 9).
 */
export const META_DRAWER_TABS = [
  { id: "f-audiences", glyph: "👥", label: "audiences" },
  { id: "f-creatives", glyph: "▤", label: "creatives" },
  { id: "f-adsets", glyph: "⊞", label: "ad sets" },
] as const;

export type MetaDrawerTab = (typeof META_DRAWER_TABS)[number]["id"];

export function isMetaDrawerTab(value: unknown): value is MetaDrawerTab {
  return META_DRAWER_TABS.some((tab) => tab.id === value);
}

/** Every drawer's tab list, so PR 5 reads its own from the same table. */
export const DRAWER_TABS: Record<
  VizPlatform,
  ReadonlyArray<{ id: string; glyph: string; label: string }>
> = {
  meta: META_DRAWER_TABS,
  tiktok: [
    { id: "tt-video", glyph: "▶", label: "video" },
    { id: "tt-refine", glyph: "👥", label: "refine" },
  ],
  google: [
    { id: "g-keywords", glyph: "⌕", label: "keywords" },
    { id: "g-copy", glyph: "¶", label: "copy" },
  ],
};

/**
 * The tab an anchor opens. An anchor for another platform, or a section
 * this drawer does not have, falls back to the first tab — the same rule
 * `anchorForIssue` uses, for the same reason: landing on the wrong tab is
 * recoverable, landing on none is not.
 */
export function tabForAnchor(
  adapter: PlanAdapterName,
  anchor: BlockerAnchor | null | undefined,
): string {
  const tabs = DRAWER_TABS[adapter];
  const first = tabs[0]!.id;
  if (!anchor || anchor.drawer !== adapter) return first;
  return tabs.some((tab) => tab.id === anchor.section) ? anchor.section : first;
}

// ── URL state ──────────────────────────────────────────────────────────

/**
 * A drawer is not a route — the URL stays `/plan/[id]` (§3). But a
 * refresh with a drawer open should reopen it, so the open drawer and its
 * tab ride in the query string and are written with a shallow replace.
 */
export const DRAWER_QUERY_KEY = "drawer";
export const DRAWER_TAB_QUERY_KEY = "tab";

/** `f` / `tt` / `g` — the glyph names, not the adapter names. */
export const DRAWER_QUERY_VALUE: Record<PlanAdapterName, string> = {
  meta: "f",
  tiktok: "tt",
  google: "g",
};

const ADAPTER_BY_QUERY: Record<string, PlanAdapterName> = {
  f: "meta",
  tt: "tiktok",
  g: "google",
};

export interface DrawerUrlState {
  adapter: PlanAdapterName | null;
  tab: string | null;
}

export function readDrawerUrl(search: {
  get(key: string): string | null;
}): DrawerUrlState {
  const raw = search.get(DRAWER_QUERY_KEY);
  const adapter = raw ? (ADAPTER_BY_QUERY[raw] ?? null) : null;
  if (!adapter) return { adapter: null, tab: null };
  const tab = search.get(DRAWER_TAB_QUERY_KEY);
  const known = DRAWER_TABS[adapter].some((entry) => entry.id === tab);
  return { adapter, tab: known ? tab : null };
}

/**
 * The path to replace to. Returns the bare path when the drawer closes,
 * so closing a drawer leaves no trace in the URL.
 */
export function drawerUrl(
  pathname: string,
  state: DrawerUrlState,
  existing?: { toString(): string },
): string {
  const params = new URLSearchParams(existing ? existing.toString() : "");
  params.delete(DRAWER_QUERY_KEY);
  params.delete(DRAWER_TAB_QUERY_KEY);
  if (state.adapter) {
    params.set(DRAWER_QUERY_KEY, DRAWER_QUERY_VALUE[state.adapter]);
    if (state.tab) params.set(DRAWER_TAB_QUERY_KEY, state.tab);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

// ── the ⊞ tab's one dependency ─────────────────────────────────────────

/**
 * Ad-set suggestions are generated from the audiences, so the `⊞` tab has
 * nothing to show until at least one audience exists. Tab order makes
 * that the natural path; this makes it legible when the operator jumps
 * straight to `⊞` from a blocker.
 */
export function adsetsTabWaiting(audienceCount: number): {
  waiting: boolean;
  waitingFor: VizPlatform;
  label: string;
} {
  return {
    waiting: audienceCount <= 0,
    waitingFor: "meta",
    label: "waiting for audiences",
  };
}

// ── blockers ───────────────────────────────────────────────────────────

/**
 * `validateStep` returns flat strings with no field attribution, so the
 * step index is the only signal for where a message belongs — which is
 * enough, because the steps map onto the tabs one-to-one.
 */
const STEP_SECTIONS: Record<number, PlanDrawerSection> = {
  3: "f-audiences",
  4: "f-creatives",
  5: "f-adsets",
  6: "f-adsets",
};

/** Steps with no tab of their own answer to `details`, at the foot of the drawer. */
export function sectionForStep(step: number): PlanDrawerSection {
  return STEP_SECTIONS[step] ?? "f-audiences";
}

export interface StepValidation {
  step: number;
  errors: readonly string[];
}

/**
 * `validateStep` results → `BlockerBadge` rows carrying the anchor that
 * opens the tab the message came from. Deduped on message, because the
 * review step re-reports every other step's errors verbatim.
 */
export function blockerRowsFromValidation(
  validations: readonly StepValidation[],
): BlockerRowModel[] {
  const seen = new Set<string>();
  const rows: BlockerRowModel[] = [];
  for (const { step, errors } of validations) {
    for (const message of errors) {
      const key = message.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        id: `step-${step}:${key}`,
        label: shortLabel(key),
        full: key,
        href: null,
        kind: "blocker",
        anchor: { drawer: "meta", section: sectionForStep(step) },
      });
    }
  }
  return rows;
}

function shortLabel(message: string, maxWords = 5): string {
  return message.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

// ── details disclosure ─────────────────────────────────────────────────

/**
 * Everything demoted out of steps 0, 1, 5 and 6 (§3a): shown DONE with a
 * provenance badge, editable inline where the wizard allowed it. A row
 * whose value is null reads as not-yet-resolved rather than as an empty
 * field, because a drawer never asks the operator to confirm a default.
 */
export interface DetailRow {
  id: DetailRowId;
  label: string;
  value: string | null;
  provenance: VizProvenance;
  /** Where the value can be changed, when it can be changed here at all. */
  editable: boolean;
}

export const DETAIL_ROW_ORDER = [
  "account",
  "pixel",
  "page",
  "instagram",
  "code",
  "name",
  "objective",
  "goal",
  "placements",
  "age",
  "geo",
  "timezone",
  "budget",
  "schedule",
  "preset",
] as const;

export type DetailRowId = (typeof DETAIL_ROW_ORDER)[number];

const DETAIL_LABELS: Record<DetailRowId, string> = {
  account: "account",
  pixel: "pixel",
  page: "page",
  instagram: "IG",
  code: "code",
  name: "name",
  objective: "objective",
  goal: "goal",
  placements: "placements",
  age: "age",
  geo: "geo",
  timezone: "tz",
  budget: "budget",
  schedule: "schedule",
  preset: "preset",
};

/**
 * Which rows the operator may still change from inside the drawer. The
 * rest are owned by the canvas (budget, schedule), the client
 * (`/clients/[id]`: account, pixel, placements, age, preset) or the event
 * (code, name, geo, timezone) — a drawer that let them be retyped here
 * would be re-opening the re-entry the redesign closed.
 */
const DETAIL_EDITABLE: ReadonlySet<DetailRowId> = new Set<DetailRowId>([
  "account",
  "pixel",
  "page",
  "instagram",
  "objective",
  "goal",
]);

export function detailRows(
  values: Partial<Record<DetailRowId, { value: string | null; provenance: VizProvenance }>>,
): DetailRow[] {
  return DETAIL_ROW_ORDER.map((id) => {
    const entry = values[id];
    return {
      id,
      label: DETAIL_LABELS[id],
      value: entry?.value ?? null,
      provenance: entry?.provenance ?? "not instrumented",
      editable: DETAIL_EDITABLE.has(id),
    };
  });
}

// ── copy ───────────────────────────────────────────────────────────────

/**
 * Every sentence the drawer can show, in one place. The drawer itself is
 * glyphs, nouns and numbers; anything that explains lives here and is
 * only ever read by an `InfoTip`.
 */
export const META_DRAWER_COPY = {
  modeNew: "new",
  modeAttachCampaign: "attach to campaign",
  modeAttachAdset: "attach to ad sets",
  modeAttachAllAdsets: "attach to all ad sets",
  modeTip:
    "Attach modes add ads to a campaign or ad sets that already exist on Meta. Audience, budget and schedule are inherited from what you attach to.",
  adsetsWaitingTip:
    "Ad-set suggestions are generated from the audiences, so add at least one audience first.",
  detailsTip:
    "Resolved from the client, the event and the plan. Everything here was decided once; change it at the source unless it is editable.",
  destinationTip:
    "The plan's destination, from the event's ticket or signup URL. Change it on the canvas — one URL serves every ad.",
  ctaTip: "One CTA per ad, applied to every variation of it.",
  pageIdentityTip:
    "The page and Instagram account this ad posts as, defaulted from the client. Edit to override for this ad only.",
  templateTip: "Load a saved campaign template into this draft.",
  launchOnCanvasTip:
    "This draft belongs to a plan, so it launches from the plan canvas with the other channels — paused, all at once.",
  launchIssuesTip:
    "Ads and lookalikes that failed at launch, and the retries that can still fix them.",
  doneTip: "Every edit is already saved. Done just closes the drawer.",
} as const;

/** The pointer that replaces wizard Launch on a plan-linked draft. */
export const LAUNCH_ON_CANVAS_LABEL = "Launch on the plan canvas";
