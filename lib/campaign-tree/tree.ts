/**
 * Campaign tree on the event (R7; records 2026-11-24-campaign-creator-replicate
 * RC6 and 2026-11-24-campaign-creator-tree-as-built RC9–RC14, frame RC-F2).
 * Pure: no I/O, no clock unless one is passed.
 *
 *   Event
 *   ├─ Signup         master campaign, then any other signup campaign
 *   │   └─ additions  oldest first
 *   ├─ Presale        only when it has campaigns
 *   ├─ On sale
 *   ├─ Show week      only when it has campaigns
 *   └─ Unsorted       last, only when it has campaigns; no stage actions
 *
 * RC14: a campaign's stage comes from stage words in its name, else from an
 * objective that means one stage. Anything else is Unsorted: a guess under
 * On sale is how a copy picks up the wrong stage. The sheet starts with every
 * live campaign and its live ad sets ticked, and every paused campaign
 * unticked (Matas, 24 Nov). A campaign with no draft on this event can't be
 * ticked (RC10).
 */

import { STAGE_LABEL, type WordFill } from "../replicate/words.ts";
import { adSetCount, frameWord, treeWord } from "./words.ts";

// ─── Stages ──────────────────────────────────────────────────────────────

/** The four stages a sheet can add to (campaign_additions.stage). */
export const TREE_STAGES = ["signup", "presale", "on_sale", "show_week"] as const;
export type TreeStage = (typeof TREE_STAGES)[number];

/** The tree's groups: the four stages, then Unsorted (RC14). */
export type TreeGroup = TreeStage | "unsorted";
export const TREE_GROUPS: readonly TreeGroup[] = [...TREE_STAGES, "unsorted"];

export function isTreeStage(value: unknown): value is TreeStage {
  return typeof value === "string" && (TREE_STAGES as readonly string[]).includes(value);
}

export function stageLabel(stage: TreeGroup): string {
  return stage === "unsorted" ? treeWord("tree.stage.unsorted") : STAGE_LABEL[stage];
}

/** Signup and On sale always show; Presale, Show week and Unsorted when they have campaigns (RC6, RC14). */
const ALWAYS_SHOWN: ReadonlySet<TreeGroup> = new Set(["signup", "on_sale"]);

/**
 * RC14: the stage words, as whole words after the [CODE]. PURCHASE, TRAFFIC,
 * REACH, TICKET(S) and REG aren't stage words.
 */
export function stageFromName(name: string | null | undefined): TreeStage | null {
  const n = ` ${(name ?? "").toUpperCase().replace(/\[[^\]]*\]/g, " ").replace(/[^A-Z0-9]+/g, " ")} `;
  if (/ SHOW WEEK | FINAL PUSH /.test(n)) return "show_week";
  if (/ PRESALE | PRE SALE /.test(n)) return "presale";
  if (/ SIGNUPS? | SIGN UP | REGISTRATION /.test(n)) return "signup";
  if (/ ON SALE | ONSALE | GEN SALE | GENERAL SALE /.test(n)) return "on_sale";
  return null;
}

/** Objectives that run in every stage, so decide nothing (RC14). */
const ANY_STAGE_DRAFT = new Set(["traffic", "awareness", "engagement", "reach"]);
const ANY_STAGE_META = new Set(["OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT", "LINK_CLICKS", "REACH", "BRAND_AWARENESS", "POST_ENGAGEMENT"]);

export function stageOfCampaign(input: {
  name?: string | null;
  /** The app draft's objective: "registration", "purchase", … */
  draftObjective?: string | null;
  /** launched_ad_sets.phase_at_launch of its ad sets: "presale" (Complete Registration) or "on_sale". */
  phaseAtLaunch?: string | null;
  /** Meta's campaign objective. */
  metaObjective?: string | null;
}): TreeGroup {
  const named = stageFromName(input.name);
  if (named) return named;
  const objective = (input.draftObjective ?? "").trim().toLowerCase();
  const meta = (input.metaObjective ?? "").trim().toUpperCase();
  if (objective === "registration") return "signup";
  if (objective === "purchase") return "on_sale";
  const phase = (input.phaseAtLaunch ?? "").trim().toLowerCase();
  // phase_at_launch calls a Complete Registration ad set "presale" (lib/launched-ad-sets/snapshot.ts): the signup campaign.
  if (phase === "presale" || phase === "registration") return "signup";
  // "on_sale" is also what a traffic, awareness or engagement ad set is stamped with,
  // so it only counts when no objective says the campaign runs in any stage.
  if (phase === "on_sale" && !ANY_STAGE_DRAFT.has(objective) && !ANY_STAGE_META.has(meta)) return "on_sale";
  if (meta === "OUTCOME_LEADS" || meta === "LEAD_GENERATION") return "signup";
  if (meta === "OUTCOME_SALES" || meta === "CONVERSIONS") return "on_sale";
  return "unsorted";
}

// ─── Status ──────────────────────────────────────────────────────────────

export type TreeStatus = "live" | "paused";

/** Meta effective_status → live / paused. Archived and deleted objects return null and aren't listed. */
export function treeStatus(effectiveStatus: string | null | undefined): TreeStatus | null | "gone" {
  const s = (effectiveStatus ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "ARCHIVED" || s === "DELETED") return "gone";
  if (s.includes("PAUSED")) return "paused";
  return "live";
}

// ─── Inputs ──────────────────────────────────────────────────────────────

export interface TreeAdSet {
  id: string;
  name: string;
  /** Null when Meta wasn't read. */
  status: TreeStatus | null;
}

export interface TreeCampaign {
  metaCampaignId: string;
  name: string;
  stage: TreeGroup;
  status: TreeStatus | null;
  adSets: TreeAdSet[];
  /** The published draft this campaign was launched from, when it's the operator's. Writes need it (the Meta write ledger is per draft). */
  draftId: string | null;
  adAccountId: string | null;
}

export interface TreeAdditionRow {
  id: string;
  meta_campaign_id: string;
  stage: string;
  kind: "creative" | "audience";
  meta_adset_ids: string[] | null;
  detail: Record<string, unknown> | null;
  onsale_refresh_line_id: string | null;
  created_at: string;
}

// ─── View ────────────────────────────────────────────────────────────────

export interface TreeAdditionView {
  id: string;
  /** "+ 4 ads added" | "+ audience added" */
  head: string;
  /** "Thu 26 Nov · to 18 ad sets · Matas" | "Fri 27 Nov · Techno page engagers → 6 ad sets · Matas" */
  line: string;
  /** "proposed by the on-sale refresh", or null. */
  refresh: string | null;
}

export interface TreeCampaignView extends TreeCampaign {
  master: boolean;
  /** RC10: "No draft on this event, so additions can't reach it." when no draft on the event made it; else null. */
  noDraft: string | null;
  /** "live · 18 ad sets" | "paused · 1 ad set" | "18 ad sets" when the status wasn't read. */
  meta: string;
  additions: TreeAdditionView[];
}

export interface TreeStageView {
  stage: TreeGroup;
  label: string;
  /** Unsorted's muted line (RC14); null for a stage. */
  line: string | null;
  /** False for Unsorted: it takes no stage additions. */
  actions: boolean;
  campaigns: TreeCampaignView[];
}

export interface TreeView {
  stages: TreeStageView[];
}

const LONDON = "Europe/London";

/** "Thu 26 Nov", in London. */
export function treeDate(iso: string, timeZone = LONDON): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Drop a trailing "· {who}" when nobody is named. */
function withoutEmptyWho(line: string): string {
  return line.replace(/ · \{who\}$/, "");
}

export function additionView(row: TreeAdditionRow, timeZone = LONDON): TreeAdditionView {
  const detail = row.detail ?? {};
  const date = treeDate(row.created_at, timeZone);
  const n = (row.meta_adset_ids ?? []).length;
  const who = str(detail.who);
  const fill: WordFill = who ? { date, n, who } : { date, n };
  let head: string;
  let line: string;
  // RC9: a one form for every count, picked by n.
  if (row.kind === "audience") {
    head = treeWord("tree.add.audience");
    const audience = str(detail.audienceName) ?? str(detail.audienceId) ?? "";
    line = withoutEmptyWho(treeWord(n === 1 ? "tree.add.audience_line.one" : "tree.add.audience_line", { ...fill, audience }));
  } else {
    const ads = num(detail.creatives) ?? num(detail.ads) ?? 0;
    head = ads === 1 ? treeWord("tree.add.creatives.one") : treeWord("tree.add.creatives", { n: ads });
    line = withoutEmptyWho(treeWord(n === 1 ? "tree.add.line.one" : "tree.add.line", fill));
  }
  return { id: row.id, head, line, refresh: row.onsale_refresh_line_id ? treeWord("tree.add.refresh") : null };
}

function campaignMeta(c: TreeCampaign): string {
  const count = adSetCount(c.adSets.length);
  if (!c.status) return count;
  return `${frameWord(c.status)} · ${count}`;
}

/** Live first, then by ad set count, then name. */
function byWeight(a: TreeCampaign, b: TreeCampaign): number {
  const live = (c: TreeCampaign) => (c.status === "paused" ? 1 : 0);
  return live(a) - live(b) || b.adSets.length - a.adSets.length || a.name.localeCompare(b.name);
}

/**
 * The Signup master: the first signup campaign listed in events.meta_campaign_id,
 * else the signup campaign with the most ad sets.
 */
export function pickMaster(signup: TreeCampaign[], eventCampaignIds: readonly string[]): string | null {
  if (signup.length === 0) return null;
  const ids = new Set(signup.map((c) => c.metaCampaignId));
  const listed = eventCampaignIds.find((id) => ids.has(id));
  if (listed) return listed;
  return [...signup].sort(byWeight)[0]!.metaCampaignId;
}

export function buildCampaignTree(input: {
  campaigns: TreeCampaign[];
  additions: TreeAdditionRow[];
  /** events.meta_campaign_id, split, in its order. */
  eventCampaignIds?: readonly string[];
  timeZone?: string;
}): TreeView {
  const additionsBy = new Map<string, TreeAdditionRow[]>();
  for (const row of [...input.additions].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const list = additionsBy.get(row.meta_campaign_id) ?? [];
    list.push(row);
    additionsBy.set(row.meta_campaign_id, list);
  }
  const master = pickMaster(
    input.campaigns.filter((c) => c.stage === "signup"),
    input.eventCampaignIds ?? [],
  );
  const stages: TreeStageView[] = [];
  for (const stage of TREE_GROUPS) {
    const campaigns = input.campaigns
      .filter((c) => c.stage === stage)
      .sort((a, b) => (a.metaCampaignId === master ? -1 : b.metaCampaignId === master ? 1 : byWeight(a, b)))
      .map((c) => ({
        ...c,
        master: c.metaCampaignId === master,
        noDraft: canWrite(c) ? null : treeWord("tree.campaign.no_draft"),
        meta: campaignMeta(c),
        additions: (additionsBy.get(c.metaCampaignId) ?? []).map((row) => additionView(row, input.timeZone)),
      }));
    if (campaigns.length === 0 && !ALWAYS_SHOWN.has(stage)) continue;
    const unsorted = stage === "unsorted";
    stages.push({ stage, label: stageLabel(stage), line: unsorted ? treeWord("tree.unsorted.line") : null, actions: !unsorted, campaigns });
  }
  return { stages };
}

// ─── The stage sheet ─────────────────────────────────────────────────────

/** Campaign id → ticked ad set ids. */
export type TreeSelection = Record<string, string[]>;

/** A campaign can be written to only through its published draft (the write ledger is per draft). */
export function canWrite(c: TreeCampaign): boolean {
  return Boolean(c.draftId);
}

/** The ad sets a tick on the campaign selects: its live ones, or every one when the campaign is paused or none is read as live. */
export function campaignTickIds(c: TreeCampaign): string[] {
  if (c.status !== "paused") {
    const live = c.adSets.filter((a) => a.status !== "paused").map((a) => a.id);
    if (live.length > 0) return live;
  }
  return c.adSets.map((a) => a.id);
}

/**
 * RC6 (Matas, 24 Nov): live campaigns start ticked with their live ad sets;
 * paused campaigns start unticked. A campaign whose status wasn't read starts
 * unticked too, and one with no draft can't be ticked.
 */
export function defaultSelection(campaigns: TreeCampaign[]): TreeSelection {
  const selection: TreeSelection = {};
  for (const c of campaigns) {
    selection[c.metaCampaignId] = c.status === "live" && canWrite(c) ? campaignTickIds(c) : [];
  }
  return selection;
}

export function toggleCampaign(selection: TreeSelection, c: TreeCampaign): TreeSelection {
  const on = (selection[c.metaCampaignId] ?? []).length > 0;
  return { ...selection, [c.metaCampaignId]: on || !canWrite(c) ? [] : campaignTickIds(c) };
}

export function toggleAdSet(selection: TreeSelection, c: TreeCampaign, adSetId: string): TreeSelection {
  if (!canWrite(c)) return selection;
  const current = selection[c.metaCampaignId] ?? [];
  const next = current.includes(adSetId) ? current.filter((id) => id !== adSetId) : [...current, adSetId];
  // Keep Meta's order.
  const order = c.adSets.map((a) => a.id);
  return { ...selection, [c.metaCampaignId]: order.filter((id) => next.includes(id)) };
}

export function selectionCounts(selection: TreeSelection): { adSets: number; campaigns: number } {
  const ticked = Object.values(selection).filter((ids) => ids.length > 0);
  return { adSets: ticked.reduce((sum, ids) => sum + ids.length, 0), campaigns: ticked.length };
}

/** Only the campaigns with a tick: the bulk-attach `campaignAdSets` shape. */
export function selectedCampaignAdSets(selection: TreeSelection): Record<string, string[]> {
  return Object.fromEntries(Object.entries(selection).filter(([, ids]) => ids.length > 0));
}

/** "{n} of {m} ad sets" ("{n} of 1 ad set"); "paused" for a paused one with none ticked. */
export function sheetCampaignLine(c: TreeCampaign, selection: TreeSelection): string {
  const n = (selection[c.metaCampaignId] ?? []).length;
  const count = c.adSets.length === 1 ? treeWord("tree.sheet.count.one", { n }) : treeWord("tree.sheet.count", { n, m: c.adSets.length });
  if (c.status === "paused") return n > 0 ? `${count} · ${treeWord("tree.sheet.paused")}` : treeWord("tree.sheet.paused");
  return count;
}

/** RC9: "Nothing ticked", "Add to 1 ad set in 1 campaign", "Add to {n} ad sets in 1 campaign", "Add to {n} ad sets in {m} campaigns". */
export function sheetButton(selection: TreeSelection): string {
  const { adSets, campaigns } = selectionCounts(selection);
  if (adSets === 0) return treeWord("tree.sheet.button.none");
  if (adSets === 1) return treeWord("tree.sheet.button.one");
  if (campaigns === 1) return treeWord("tree.sheet.button.campaign", { n: adSets });
  return treeWord("tree.sheet.button", { n: adSets, m: campaigns });
}

export function creativesSheetTitle(creatives: number, stage: TreeStage): string {
  return creatives === 1
    ? treeWord("tree.sheet.title.creatives.one", { stage: stageLabel(stage) })
    : treeWord("tree.sheet.title.creatives", { n: creatives, stage: stageLabel(stage) });
}

// ─── A run's outcome, in words (RC12) ────────────────────────────────────

/** An ad set a run didn't add to: "refused" (Meta or a guard said no, nothing changed) or "failed" (didn't go through). */
export interface NotAdded {
  name: string;
  kind: "refused" | "failed";
}

/** "Not added to {n} ad sets:" and one row each. Ad sets that already had it count as added. */
export function notAddedLines(rows: NotAdded[]): { heading: string; rows: string[] } | null {
  if (rows.length === 0) return null;
  return {
    heading: rows.length === 1 ? treeWord("tree.result.heading.one") : treeWord("tree.result.heading", { n: rows.length }),
    rows: rows.map((r) => treeWord(r.kind === "refused" ? "tree.result.refused" : "tree.result.failed", { "ad set": r.name })),
  };
}

/** The sheet's error line: the run stopped. Never the server's message, a code or an HTTP status. */
export function runErrorLine(input: { added: number; logUnavailable?: boolean }): string {
  if (input.logUnavailable && input.added === 0) return treeWord("tree.error.log");
  if (input.added === 0) return treeWord("tree.error.none");
  return input.added === 1 ? treeWord("tree.error.partial.one") : treeWord("tree.error.partial", { n: input.added });
}

export function audienceSheetTitle(audience: string | null, stage: TreeStage): string {
  return audience ? treeWord("tree.sheet.title.audience", { audience, stage: stageLabel(stage) }) : treeWord("tree.action.audience");
}

/** RC-F shows three ad sets, then "… and {n} more". */
export const SHEET_AD_SETS_SHOWN = 3;

export function moreLine(hidden: number): string | null {
  return hidden > 0 ? frameWord("more", { n: hidden }) : null;
}

/** The campaigns of one stage, for its sheet. Campaigns in another ad account than the stage's first writable one are left out: bulk-attach runs one account at a time. */
export function stageSheetCampaigns(view: TreeView, stage: TreeStage): TreeCampaign[] {
  const campaigns = view.stages.find((s) => s.stage === stage)?.campaigns ?? [];
  const account = campaigns.find((c) => canWrite(c) && c.adAccountId)?.adAccountId ?? null;
  return campaigns.filter((c) => !account || !c.adAccountId || c.adAccountId === account);
}

export function stageAccount(campaigns: TreeCampaign[]): string | null {
  return campaigns.find((c) => canWrite(c) && c.adAccountId)?.adAccountId ?? campaigns.find((c) => c.adAccountId)?.adAccountId ?? null;
}

/**
 * A creatives run's outcome (bulk-attach with `tree`): each ticked ad set
 * either holds the run's ads (`adSetsAdded`, made now or on an earlier try)
 * or didn't go through.
 */
export function treeRunNotAdded(
  picked: Record<string, string[]>,
  results: Array<{ campaignId: string; adSetsAdded?: string[] }>,
  campaigns: TreeCampaign[],
): { added: number; notAdded: NotAdded[] } {
  const names = new Map(campaigns.flatMap((c) => c.adSets.map((a) => [a.id, a.name] as const)));
  const byCampaign = new Map(results.map((r) => [r.campaignId, new Set(r.adSetsAdded ?? [])]));
  let added = 0;
  const notAdded: NotAdded[] = [];
  for (const [campaignId, ids] of Object.entries(picked)) {
    const got = byCampaign.get(campaignId) ?? new Set<string>();
    for (const id of ids) {
      if (got.has(id)) added += 1;
      else notAdded.push({ name: names.get(id) ?? id, kind: "failed" });
    }
  }
  return { added, notAdded };
}
