/**
 * Campaign tree on the event (R7; record 2026-11-24-campaign-creator-replicate,
 * RC6, frame RC-F). Pure: no I/O, no clock unless one is passed.
 *
 *   Event
 *   ├─ Signup         master campaign, then any other signup campaign
 *   │   └─ additions  oldest first
 *   ├─ Presale        only when it has campaigns
 *   ├─ On sale
 *   └─ Show week      only when it has campaigns
 *
 * A campaign's stage comes from its name ("[CODE] SIGNUP", "[CODE] ON SALE"),
 * else the draft's objective, else its ad sets' phase_at_launch, else Meta's
 * objective, else On sale. The stage actions' sheet starts with every live
 * campaign and its live ad sets ticked, and every paused campaign unticked
 * (Matas, 24 Nov).
 */

import { STAGE_LABEL, type WordFill } from "../replicate/words.ts";
import { adSetCount, frameWord, treeWord } from "./words.ts";

// ─── Stages ──────────────────────────────────────────────────────────────

export const TREE_STAGES = ["signup", "presale", "on_sale", "show_week"] as const;
export type TreeStage = (typeof TREE_STAGES)[number];

export function isTreeStage(value: unknown): value is TreeStage {
  return typeof value === "string" && (TREE_STAGES as readonly string[]).includes(value);
}

export function stageLabel(stage: TreeStage): string {
  return STAGE_LABEL[stage];
}

/** Signup and On sale always show; Presale and Show week when they have campaigns (RC6). */
const ALWAYS_SHOWN: ReadonlySet<TreeStage> = new Set(["signup", "on_sale"]);

const ON_SALE_OBJECTIVES = new Set(["purchase", "initiate_checkout", "traffic", "awareness", "engagement"]);
const META_ON_SALE = new Set(["OUTCOME_TRAFFIC", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT", "LINK_CLICKS", "REACH", "BRAND_AWARENESS"]);

/** The stage a campaign's name says, or null. Matched on words, in this order. */
export function stageFromName(name: string | null | undefined): TreeStage | null {
  const n = ` ${(name ?? "").toUpperCase().replace(/\[[^\]]*\]/g, " ").replace(/[^A-Z0-9]+/g, " ")} `;
  if (/ SHOW ?WEEK | FINAL PUSH /.test(n)) return "show_week";
  if (/ PRE ?SALE /.test(n)) return "presale";
  if (/ SIGN ?UPS? | REGISTRATIONS? | REG /.test(n)) return "signup";
  if (/ ON ?SALE | GEN(ERAL)? ?SALE | PURCHASE | TRAFFIC | REACH | TICKETS? /.test(n)) return "on_sale";
  return null;
}

export function stageOfCampaign(input: {
  name?: string | null;
  /** The app draft's objective: "registration", "purchase", … */
  draftObjective?: string | null;
  /** launched_ad_sets.phase_at_launch of its ad sets: "presale" (Complete Registration) or "on_sale". */
  phaseAtLaunch?: string | null;
  /** Meta's campaign objective. */
  metaObjective?: string | null;
}): TreeStage {
  const named = stageFromName(input.name);
  if (named) return named;
  const objective = (input.draftObjective ?? "").trim().toLowerCase();
  if (objective === "registration") return "signup";
  if (ON_SALE_OBJECTIVES.has(objective)) return "on_sale";
  const phase = (input.phaseAtLaunch ?? "").trim().toLowerCase();
  // phase_at_launch calls a Complete Registration ad set "presale" (lib/launched-ad-sets/snapshot.ts): that's the signup campaign.
  if (phase === "presale" || phase === "registration") return "signup";
  if (phase === "on_sale") return "on_sale";
  const meta = (input.metaObjective ?? "").trim().toUpperCase();
  if (meta === "OUTCOME_LEADS" || meta === "LEAD_GENERATION") return "signup";
  if (META_ON_SALE.has(meta)) return "on_sale";
  return "on_sale";
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
  stage: TreeStage;
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
  /** "live · 18 ad sets" | "paused · 1 ad set" | "18 ad sets" when the status wasn't read. */
  meta: string;
  additions: TreeAdditionView[];
}

export interface TreeStageView {
  stage: TreeStage;
  label: string;
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
  if (row.kind === "audience") {
    head = treeWord("tree.add.audience");
    const audience = str(detail.audienceName) ?? str(detail.audienceId) ?? "";
    line = withoutEmptyWho(treeWord("tree.add.audience_line", { ...fill, audience }));
  } else {
    head = treeWord("tree.add.creatives", { n: num(detail.creatives) ?? num(detail.ads) ?? 0 });
    line = withoutEmptyWho(treeWord("tree.add.line", fill));
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
  for (const stage of TREE_STAGES) {
    const campaigns = input.campaigns
      .filter((c) => c.stage === stage)
      .sort((a, b) => (a.metaCampaignId === master ? -1 : b.metaCampaignId === master ? 1 : byWeight(a, b)))
      .map((c) => ({
        ...c,
        master: c.metaCampaignId === master,
        meta: campaignMeta(c),
        additions: (additionsBy.get(c.metaCampaignId) ?? []).map((row) => additionView(row, input.timeZone)),
      }));
    if (campaigns.length === 0 && !ALWAYS_SHOWN.has(stage)) continue;
    stages.push({ stage, label: stageLabel(stage), campaigns });
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

/** "{n} of {m} ad sets" for a ticked campaign; "paused" for a paused one with none ticked. */
export function sheetCampaignLine(c: TreeCampaign, selection: TreeSelection): string {
  const n = (selection[c.metaCampaignId] ?? []).length;
  const count = treeWord("tree.sheet.count", { n, m: c.adSets.length });
  if (c.status === "paused") return n > 0 ? `${count} · ${treeWord("tree.sheet.paused")}` : treeWord("tree.sheet.paused");
  return count;
}

export function sheetButton(selection: TreeSelection): string {
  const { adSets, campaigns } = selectionCounts(selection);
  return treeWord("tree.sheet.button", { n: adSets, m: campaigns });
}

export function creativesSheetTitle(creatives: number, stage: TreeStage): string {
  return treeWord("tree.sheet.title.creatives", { n: creatives, stage: stageLabel(stage) });
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
