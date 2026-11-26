/**
 * lib/mcp/today/log.ts — Today's rows for Claude's Meta changes (FC1, and
 * record 2026-11-26-mcp-m3b-today MB1–MB3). Pure: the loader (load.ts)
 * reads the rows, this draws them.
 *
 * One row per connector call that changed or tried to change Meta, newest
 * first, today only (London):
 *   - launch_draft (FC1), and M3b's pause and resume (campaign, ad set, ad),
 *     set_budget, move_budget, rename, add_creatives_to_stage,
 *     add_audience_to_stage and create_split_test (MB1): the title
 *     "{action} · {code}", Step 0's or MB1's change line, "Approved in
 *     Claude · {date, time}" with What Claude asked (the question and answer
 *     as stored on the action), and the outcome;
 *   - a set_budget with a time is its scheduled_meta_changes row instead
 *     (MB2): waiting at the top with Cancel, on every day until it runs;
 *     then in the day's log at its run time ("Ran as scheduled"), or at its
 *     cancel time ("Cancelled by {name}" / "Cancelled in Claude");
 *   - refusals Matas acts on, muted (FC1, MB3): no approval, over the
 *     ceiling, no ceiling, switched off, launch checks. Refusals that only
 *     correct what Claude sent (a wrong id, a bad date, a budget type) stay
 *     out, as do reads (get_live, list_scheduled), cancel_scheduled (its
 *     scheduled row says it) and calls that changed nothing ("already
 *     paused").
 *
 * Undo (FC1, MB1), where M3b can put it back: pause ↔ resume, a budget back
 * (daily or lifetime), a whole move back, a rename back, and a delete of
 * paused objects Claude made (a paused launch, paused ads). None on added
 * audiences, a part-done move or a test. Once an object changed after the
 * change (a later change in this log, or found at Undo time), "Changed since,
 * so Undo is off.".
 *
 * Every word is a row (words.ts). Nothing raw from Meta: outcomes are
 * counts and ids.
 *
 * Relative imports only (node:test).
 */
import { stageLabel, type TreeGroup } from "../../campaign-tree/tree.ts";
import { londonWhen } from "../live/resolve.ts";
import type { ScheduledRow } from "../live/scheduled.ts";
import { countAdSets, countAds, countScheduled, countToday, money, reasonOf, result, things, tw, type Thing, type TodayMetaKey } from "./words.ts";

type Json = Record<string, unknown>;

/** One mcp_actions row, as the loader reads it. */
export interface LoggedAction {
  id: string;
  tool: string;
  status: string;
  args: Json | null;
  result: Json | null;
  event_id: string | null;
  client_id: string | null;
  approved_at: string | null;
  created_at: string;
}

/** An Undo Matas pressed on Today: an mcp_actions row, tool today_undo, result.undoOf the row's key. */
export interface UndoAttempt {
  status: string;
  result: Json | null;
  created_at: string;
}

export const UNDO_TOOL = "today_undo";

/** The tools whose calls are rows. */
export const LOGGED_TOOLS = ["launch_draft", "pause", "resume", "set_budget", "move_budget", "rename", "add_creatives_to_stage", "add_audience_to_stage", "create_split_test"] as const;
export type LoggedTool = (typeof LOGGED_TOOLS)[number];

/** Meta refused the whole change (MB1: "Failed · Meta didn't take it, so nothing changed"). */
const META_REFUSED = new Set(["meta_failed", "launch_failed", "attach_failed", "attach_threw", "upload_failed", "upload_threw", "video_not_ready", "copy_failed", "none_written"]);

export interface LogContext {
  /** Event id → code. */
  codes: Map<string, string>;
  /** Client id → name. */
  clientNames: Map<string, string>;
  /** Draft id → name (launch_draft's {draft}). */
  draftNames: Map<string, string>;
  /** The viewer's name: "Undone by {name}", "Cancelled by {name}" (only Matas sees the section, and only he can press either). */
  viewerName: string;
  /** London midnight today (ISO): the log is today's. */
  since: string;
}

export interface UndoButton {
  label: string;
  /** The line beside Undo: what it does. */
  line: string;
  /** A delete confirms once (FC1). */
  confirm: { question: string; cancel: string; button: string } | null;
}

export interface MetaLogRow {
  /** The action id, or "scheduled:{id}". Undo and Cancel post it back. */
  key: string;
  /** Where it sits in the log. */
  at: string;
  /** The 4 px edge: olive done, brick failed, ochre waiting, muted. */
  edge: "done" | "failed" | "waiting" | "muted";
  title: string;
  change: string;
  approved: string | null;
  asked: string | null;
  askedQ: string | null;
  askedA: string | null;
  /** MB2, waiting: "Scheduled for {date, time}", with Cancel and its note. */
  scheduled: string | null;
  cancel: { label: string; note: string } | null;
  /** MB2: "Cancelled by {name} · …" / "Cancelled in Claude · …". */
  cancelled: string | null;
  /** MB2: "Ran as scheduled · …". */
  ran: string | null;
  /** done olive, failed brick, refused brick on a muted row (FC1), muted grey (skipped). */
  outcome: { text: string; tone: "done" | "failed" | "refused" | "muted" } | null;
  undo: UndoButton | null;
  /** In place of Undo, or after it: the test line, the live line, changed since, undone, undo refused. */
  note: string | null;
}

// ── Reading the stored rows ──────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
const kindOf = (v: unknown): "campaign" | "adset" | "ad" => (v === "ad_set" || v === "adset" ? "adset" : v === "ad" ? "ad" : "campaign");

/** "Fri 27 Nov": a test's {start} and {end} (MB1), London's date. */
export function londonDay(iso: string): string {
  return londonWhen(iso).split(",")[0]!;
}

function codeOf(a: LoggedAction, ctx: LogContext): string {
  const fromRow = str(a.result?.code) ?? str(a.args?.event);
  if (fromRow) return fromRow.trim().toUpperCase();
  return (a.event_id && ctx.codes.get(a.event_id)) || "";
}

function title(action: TodayMetaKey, code: string): string {
  return tw("today.mcp.row.title", { action: tw(action), code });
}

function approvedLines(at: string | null, args: Json | null): Pick<MetaLogRow, "approved" | "asked" | "askedQ" | "askedA"> {
  const approval = (args?.approval ?? null) as { asked?: unknown; answer?: unknown } | null;
  const q = typeof approval?.asked === "string" ? approval.asked : null;
  const a = typeof approval?.answer === "string" ? approval.answer : null;
  if (!at || q == null || a == null) return { approved: null, asked: null, askedQ: null, askedA: null };
  return {
    approved: tw("today.mcp.row.approved_in_claude", { "date, time": londonWhen(at) }),
    asked: tw("today.mcp.row.asked"),
    askedQ: tw("today.mcp.row.asked.q", { asked: q }),
    askedA: tw("today.mcp.row.asked.a", { answer: a }),
  };
}

const ACTION_KEY: Record<Exclude<LoggedTool, "pause" | "resume">, TodayMetaKey> = {
  launch_draft: "today.mcp.action.launch_draft",
  set_budget: "today.mcp.action.set_budget",
  move_budget: "today.mcp.action.move_budget",
  rename: "today.mcp.action.rename",
  add_creatives_to_stage: "today.mcp.action.add_creatives",
  add_audience_to_stage: "today.mcp.action.add_audiences",
  create_split_test: "today.mcp.action.split_test",
};

function actionKey(a: LoggedAction): TodayMetaKey {
  if (a.tool === "pause" || a.tool === "resume") {
    const k = kindOf(a.result?.kind ?? a.args?.kind);
    if (a.tool === "pause") return k === "campaign" ? "today.mcp.action.pause_campaign" : k === "adset" ? "today.mcp.action.pause_adset" : "today.mcp.action.pause_ad";
    return k === "campaign" ? "today.mcp.action.resume_campaign" : k === "adset" ? "today.mcp.action.resume_adset" : "today.mcp.action.resume_ad";
  }
  return ACTION_KEY[a.tool as keyof typeof ACTION_KEY];
}

/** "{name}: £{x} → £{y} {per}", or "{name}: to £{y} {per}" with no recorded old amount (MB1). */
export function budgetLine(name: string, beforeMinor: number | null, afterMinor: number, lifetime: boolean): string {
  const per = tw(lifetime ? "today.mcp.per.lifetime" : "today.mcp.per.day");
  return beforeMinor == null
    ? tw("today.mcp.change.budget.to", { name, y: money(afterMinor / 100), per })
    : tw("today.mcp.change.budget", { name, x: money(beforeMinor / 100), y: money(afterMinor / 100), per });
}

function stageWord(v: unknown): string {
  const s = str(v);
  return s ? stageLabel(s as TreeGroup) : "";
}

/** Step 0's or MB1's change line for one call, from what its row stored (the args when it was refused before a read). */
function changeLine(a: LoggedAction, ctx: LogContext): string {
  const r = a.result ?? {};
  const args = a.args ?? {};
  switch (a.tool as LoggedTool) {
    case "launch_draft": {
      const draftId = str(r.draftId) ?? str(args.draft_id);
      const name = str(r.campaignName) ?? (draftId ? ctx.draftNames.get(draftId) : null) ?? draftId ?? "";
      const live = (str(r.mode) ?? str(args.mode)) === "live";
      return tw(live ? "today.mcp.change.launch.live" : "today.mcp.change.launch.paused", { draft: name });
    }
    case "pause":
    case "resume": {
      const name = str(r.name) ?? str(r.objectId) ?? str(args.id) ?? "";
      return tw(a.tool === "pause" ? "today.mcp.change.pause" : "today.mcp.change.resume", { name });
    }
    case "set_budget": {
      const name = str(r.name) ?? str(r.objectId) ?? str(args.id) ?? "";
      const lifetime = (str(r.field) ?? (args.lifetime_gbp != null ? "lifetime_budget" : "daily_budget")) === "lifetime_budget";
      const after = num(r.after) ?? Math.round((num(lifetime ? args.lifetime_gbp : args.daily_gbp) ?? 0) * 100);
      return budgetLine(name, num(r.before), after, lifetime);
    }
    case "move_budget": {
      const x = (num(r.deltaMinor) ?? Math.round((num(args.gbp_a_day) ?? 0) * 100)) / 100;
      return tw("today.mcp.change.move_budget", { x: money(x), from: str(r.fromName) ?? str(args.from_ad_set) ?? "", to: str(r.toName) ?? str(args.to_ad_set) ?? "" });
    }
    case "rename":
      return tw("today.mcp.change.rename", { before: str(r.before) ?? str(args.id) ?? "", after: str(r.after) ?? str(args.name) ?? "" });
    case "add_creatives_to_stage": {
      const ads = list(r.adIds).length || num(r.adsPlanned) || 0;
      const sets = list(r.adSetsReached).length || num(r.adSets) || 0;
      return tw("today.mcp.change.add_creatives", { stage: stageWord(r.stage ?? args.stage), ads: countAds(ads), adsets: countAdSets(sets) });
    }
    case "add_audience_to_stage": {
      const sets = list(r.written).length || num(r.adSets) || 0;
      const names = str(r.audienceNames) ?? (list(args.audience_ids).join(" · ") || str(args.template) || "");
      return tw("today.mcp.change.add_audiences", { stage: stageWord(r.stage ?? args.stage), audiences: names, adsets: countAdSets(sets) });
    }
    case "create_split_test": {
      const ids = list(r.campaigns).length ? list(r.campaigns) : list(args.campaign_ids);
      const start = str(r.start) ?? str(args.start);
      const end = str(r.end) ?? str(args.end);
      return tw("today.mcp.change.split_test", {
        a: str(r.aName) ?? ids[0] ?? "",
        b: str(r.bName) ?? ids[1] ?? "",
        start: start && !Number.isNaN(Date.parse(start)) ? londonDay(start) : "",
        end: end && !Number.isNaN(Date.parse(end)) ? londonDay(end) : "",
      });
    }
  }
  return "";
}

/** The Meta objects a call changed, for "Changed since" (a later change to any of them turns Undo off). */
export function objectsOf(a: LoggedAction): string[] {
  const r = a.result ?? {};
  switch (a.tool as LoggedTool) {
    case "launch_draft":
      return [str(r.metaCampaignId), ...list(r.adSetIds), ...list(r.adIds)].filter((x): x is string => Boolean(x));
    case "pause":
    case "resume":
    case "set_budget":
    case "rename":
      return [str(r.objectId)].filter((x): x is string => Boolean(x));
    case "move_budget":
      return [str(r.fromAdsetId), str(r.toAdsetId)].filter((x): x is string => Boolean(x));
    case "add_creatives_to_stage":
      // New ads, and the ad sets they went into (a launch's delete would take them with it).
      return [...list(r.adIds), ...list(r.adSetsReached)];
    case "add_audience_to_stage":
      return list(r.written);
    case "create_split_test":
      return list(r.campaigns);
  }
  return [];
}

/** What a row's Undo needs left as it was: the ads Claude added (not the ad sets they're in), else what it changed. */
export function dependsOn(a: LoggedAction): string[] {
  if (a.tool === "add_creatives_to_stage") return list(a.result?.adIds);
  return objectsOf(a);
}

/** Whether a done call changed Meta (a no-op answer and a scheduled set_budget didn't). */
function changedMeta(a: LoggedAction): boolean {
  return a.status === "done" && !a.result?.noop && !a.result?.scheduledId;
}

// ── Outcomes and Undo ────────────────────────────────────────────────────────

/** Refusals Matas acts on (FC1, MB3), logged muted: no approval, over the ceiling, no ceiling, switched off, launch checks. */
function refusedText(a: LoggedAction, ctx: LogContext): string | null {
  const r = a.result ?? {};
  const why = str(r.refused);
  if (why === "no_approval") return tw("today.mcp.row.refused.no_approval");
  // The show's spend ceiling (#1397): the show's code, its committed spend after the change and its ceiling.
  if (why === "over_ceiling") return tw("today.mcp.row.refused", { code: codeOf(a, ctx), x: money(num(r.committedAfter) ?? 0), c: money(num(r.ceilingGbp) ?? 0) });
  if (why === "no_ceiling") return tw("today.mcp.row.refused.none", { code: codeOf(a, ctx) });
  if (why === "switch_off") return tw("today.mcp.row.refused.switch");
  if (why === "launch_checks") {
    // launch_draft's checksRefusal: the launch checks' blockers plus the wizard's.
    const n = (num((r.launchChecks as Json | undefined)?.blockers) ?? 0) + (num((r.wizardChecks as Json | undefined)?.blockers) ?? 0);
    return n === 1 ? tw("today.mcp.row.refused.checks.one") : tw("today.mcp.row.refused.checks", { n });
  }
  return null;
}

/** Done · {result} for a call that ran (TD's counts and ids; MB1's "1 test created · {id}"). */
function doneResult(a: LoggedAction): { text: string; partial: boolean } {
  const r = a.result ?? {};
  const kind = kindOf(r.kind ?? a.args?.kind) as Thing;
  switch (a.tool as LoggedTool) {
    case "launch_draft":
      return { text: result("launched", "campaign", [str(r.metaCampaignId) ?? ""]), partial: false };
    case "pause":
    case "resume":
    case "set_budget":
    case "rename":
      return { text: result("changed", kind, [str(r.objectId) ?? ""]), partial: false };
    case "move_budget":
      return { text: result("changed", "adset", [str(r.fromAdsetId) ?? "", str(r.toAdsetId) ?? ""]), partial: false };
    case "add_creatives_to_stage":
      return { text: result("added", "ad", list(r.adIds)), partial: list(r.missed).length > 0 };
    case "add_audience_to_stage":
      return { text: result("changed", "adset", list(r.written)), partial: num(r.skipped) != null && num(r.skipped)! > 0 };
    case "create_split_test":
      return { text: result("created", "test", [str(r.studyId) ?? ""]), partial: false };
  }
  return { text: "", partial: false };
}

function deleteButton(n: number, thing: Thing): UndoButton {
  const [one, many] = things(thing);
  return {
    label: tw("today.mcp.undo"),
    line: n === 1 ? tw("today.mcp.undo.delete.one", { thing: one }) : tw("today.mcp.undo.delete", { n, things: many }),
    confirm: {
      question: n === 1 ? tw("today.mcp.undo.confirm.one", { thing: one }) : tw("today.mcp.undo.confirm", { n, things: many }),
      cancel: tw("today.mcp.undo.cancel"),
      button: tw("today.mcp.undo.confirm.button"),
    },
  };
}

const plain = (line: string): UndoButton => ({ label: tw("today.mcp.undo"), line, confirm: null });

/** What Undo would do for a call that ran, or the line that stands in its place. Null: nothing to say (added audiences). */
function undoFor(a: LoggedAction): { button: UndoButton | null; note: string | null } {
  const r = a.result ?? {};
  switch (a.tool as LoggedTool) {
    case "pause":
      return { button: plain(tw("today.mcp.undo.resume")), note: null };
    case "resume":
      return { button: plain(tw("today.mcp.undo.pause")), note: null };
    case "set_budget": {
      const before = num(r.before);
      if (before == null) return { button: null, note: null };
      const lifetime = str(r.field) === "lifetime_budget";
      return { button: plain(tw(lifetime ? "today.mcp.undo.budget.lifetime" : "today.mcp.undo.budget", { x: money(before / 100) })), note: null };
    }
    case "move_budget":
      return { button: plain(tw("today.mcp.undo.move", { x: money((num(r.deltaMinor) ?? 0) / 100), from: str(r.fromName) ?? str(r.fromAdsetId) ?? "" })), note: null };
    case "rename":
      return { button: plain(tw("today.mcp.undo.rename")), note: null };
    case "add_creatives_to_stage":
      if (r.live === true) return { button: null, note: tw("today.mcp.undo.live") };
      return { button: list(r.adIds).length ? deleteButton(list(r.adIds).length, "ad") : null, note: null };
    case "launch_draft":
      if ((str(r.mode) ?? str(a.args?.mode)) === "live") return { button: null, note: tw("today.mcp.undo.live") };
      return { button: str(r.metaCampaignId) ? deleteButton(1, "campaign") : null, note: null };
    case "create_split_test":
      return { button: null, note: tw("today.mcp.undo.test") };
    case "add_audience_to_stage":
      return { button: null, note: null };
  }
  return { button: null, note: null };
}

/** Refusals that may pass on a second press (Meta didn't answer): the row keeps its Undo beside the reason. */
export const RETRYABLE = new Set(["meta_failed", "meta_unread"]);

/** The latest Undo pressed for `key`: done → "Undone by …"; changed → off; anything else → "Undo refused · {reason}". */
function undoState(key: string, undos: readonly UndoAttempt[], ctx: LogContext): { line: string; retry: boolean } | null {
  const mine = undos.filter((u) => u.result?.undoOf === key).sort((x, y) => y.created_at.localeCompare(x.created_at));
  const last = mine[0];
  if (!last) return null;
  if (last.status === "done") return { line: tw("today.mcp.undo.done", { name: ctx.viewerName, "date, time": londonWhen(last.created_at) }), retry: false };
  if (last.result?.refused === "changed") return { line: tw("today.mcp.undo.off"), retry: false };
  const reason = str(last.result?.reason) ?? reasonOf(tw("today.mcp.row.failed.none"));
  return { line: tw("today.mcp.undo.refused", { reason }), retry: RETRYABLE.has(String(last.result?.refused ?? "")) };
}

/** Undo, with what stops it: undone already, an Undo refused, or a later change to the same object. */
function withUndo(key: string, at: string, objects: readonly string[], base: { button: UndoButton | null; note: string | null }, later: readonly { at: string; objects: readonly string[]; key: string }[], undos: readonly UndoAttempt[], ctx: LogContext) {
  if (!base.button) return { undo: null, note: base.note };
  const state = undoState(key, undos, ctx);
  if (state) return { undo: state.retry ? base.button : null, note: state.line };
  const touched = later.some((l) => l.key !== key && l.at > at && l.objects.some((o) => objects.includes(o)));
  if (touched) return { undo: null, note: tw("today.mcp.undo.off") };
  return { undo: base.button, note: null };
}

const empty = (): Omit<MetaLogRow, "key" | "at" | "edge" | "title" | "change"> => ({
  approved: null,
  asked: null,
  askedQ: null,
  askedA: null,
  scheduled: null,
  cancel: null,
  cancelled: null,
  ran: null,
  outcome: null,
  undo: null,
  note: null,
});

// ── The log ──────────────────────────────────────────────────────────────────

export interface MetaLog {
  /** Waiting scheduled changes, soonest first (MB2: at the top, on every day until they run). */
  waiting: MetaLogRow[];
  /** Today's rows, newest first. */
  rows: MetaLogRow[];
}

export function buildMetaLog(input: { actions: readonly LoggedAction[]; undos: readonly UndoAttempt[]; scheduled: readonly ScheduledRow[]; ctx: LogContext }): MetaLog {
  const { ctx } = input;
  const actions = input.actions.filter((a) => (LOGGED_TOOLS as readonly string[]).includes(a.tool));
  // Every later change, for "Changed since": calls that changed Meta, scheduled changes that ran, and Undos that ran.
  const later = [
    ...actions.filter(changedMeta).map((a) => ({ key: a.id, at: a.created_at, objects: objectsOf(a) })),
    ...input.scheduled.filter((s) => s.status === "applied").map((s) => ({ key: `scheduled:${s.id}`, at: s.run_at, objects: [s.object_id] })),
  ];

  const rows: MetaLogRow[] = [];
  for (const a of actions) {
    if (a.created_at < ctx.since) continue;
    const head = { key: a.id, at: a.created_at, title: title(actionKey(a), codeOf(a, ctx)), change: changeLine(a, ctx) };
    if (a.status === "done") {
      if (!changedMeta(a)) continue;
      const done = doneResult(a);
      const u = done.partial ? { undo: null, note: null } : withUndo(a.id, a.created_at, dependsOn(a), undoFor(a), later, input.undos, ctx);
      rows.push({
        ...empty(),
        ...head,
        edge: done.partial ? "failed" : "done",
        ...approvedLines(a.approved_at, a.args),
        outcome: { text: tw(done.partial ? "today.mcp.row.failed" : "today.mcp.row.done", { result: done.text }), tone: done.partial ? "failed" : "done" },
        ...u,
      });
      continue;
    }
    const r = a.result ?? {};
    const why = str(r.refused);
    const refused = refusedText(a, ctx);
    if (refused) {
      rows.push({ ...empty(), ...head, edge: "muted", outcome: { text: refused, tone: "refused" } });
      continue;
    }
    // A move that only lowered one side: TD's "Failed · 1 of 2 ad sets changed · {id}", no Undo.
    if (a.tool === "move_budget" && list(r.written).length > 0) {
      const written = list(r.written);
      rows.push({ ...empty(), ...head, edge: "failed", ...approvedLines(a.approved_at, a.args), outcome: { text: tw("today.mcp.row.failed", { result: tw("today.mcp.result.partial", { n: written.length, m: 2, things: things("adset")[1], ids: written.join(", ") }) }), tone: "failed" } });
      continue;
    }
    // A launch that stopped part way: what was made, and (paused) Undo deletes it (M3a: "Matas can delete it on Today").
    if (a.tool === "launch_draft" && why === "launch_partial" && str(r.metaCampaignId)) {
      const paused = (str(r.mode) ?? str(a.args?.mode)) !== "live";
      const base = paused ? { button: deleteButton(1, "campaign"), note: null } : { button: null, note: tw("today.mcp.undo.live") };
      rows.push({
        ...empty(),
        ...head,
        edge: "failed",
        ...approvedLines(a.approved_at, a.args),
        outcome: { text: tw("today.mcp.row.failed", { result: result("launched", "campaign", [str(r.metaCampaignId)!]) }), tone: "failed" },
        ...withUndo(a.id, a.created_at, [str(r.metaCampaignId)!], base, later, input.undos, ctx),
      });
      continue;
    }
    if (why && META_REFUSED.has(why)) {
      rows.push({ ...empty(), ...head, edge: "failed", ...approvedLines(a.approved_at, a.args), outcome: { text: tw("today.mcp.row.failed.none"), tone: "failed" } });
    }
    // Anything else corrected what Claude sent: not logged (MB3).
  }

  const waiting: MetaLogRow[] = [];
  for (const s of input.scheduled) {
    const row = scheduledRow(s, ctx, later, input.undos);
    if (!row) continue;
    if (row.edge === "waiting") waiting.push(row);
    else if (row.at >= ctx.since) rows.push(row);
  }
  waiting.sort((x, y) => x.at.localeCompare(y.at));
  rows.sort((x, y) => y.at.localeCompare(x.at));
  return { waiting, rows };
}

/** MB2: one scheduled budget change, from waiting to ran, skipped, failed or cancelled. */
export function scheduledRow(s: ScheduledRow, ctx: LogContext, later: readonly { at: string; objects: readonly string[]; key: string }[] = [], undos: readonly UndoAttempt[] = []): MetaLogRow | null {
  const key = `scheduled:${s.id}`;
  const code = (s.event_id && ctx.codes.get(s.event_id)) || "";
  const lifetime = s.field === "lifetime_budget";
  const before = s.expected_minor == null ? null : Number(s.expected_minor);
  const head = {
    key,
    title: title("today.mcp.action.set_budget", code),
    change: budgetLine(s.object_name ?? s.object_id, before, Number(s.amount_minor), lifetime),
    ...approvedLines(s.created_at ?? null, { approval: { asked: s.approval_asked, answer: s.approval_answer } }),
  };
  if (s.status === "scheduled" || s.status === "applying") {
    return {
      ...empty(),
      ...head,
      at: s.run_at,
      edge: "waiting",
      scheduled: tw("today.mcp.row.scheduled", { "date, time": londonWhen(s.run_at) }),
      // Applying: the cron has claimed it, so Cancel would find it no longer scheduled.
      cancel: s.status === "scheduled" ? { label: tw("today.mcp.cancel"), note: tw("today.mcp.row.scheduled.note") } : null,
    };
  }
  if (s.status === "cancelled") {
    const at = s.cancelled_at ?? s.run_at;
    const byToday = (s.outcome as Json | null)?.cancelled_by === "today";
    return {
      ...empty(),
      ...head,
      at,
      edge: "muted",
      cancelled: byToday ? tw("today.mcp.row.cancelled", { name: ctx.viewerName, "date, time": londonWhen(at) }) : tw("today.mcp.row.cancelled.claude", { "date, time": londonWhen(at) }),
    };
  }
  const ran = tw("today.mcp.row.ran", { "date, time": londonWhen(s.run_at) });
  const reason = str((s.outcome as Json | null)?.reason);
  if (s.status === "applied") {
    const undoBefore = num((s.outcome as Json | null)?.before) ?? before;
    const base = undoBefore == null ? { button: null, note: null } : { button: plain(tw(lifetime ? "today.mcp.undo.budget.lifetime" : "today.mcp.undo.budget", { x: money(undoBefore / 100) })), note: null };
    return {
      ...empty(),
      ...head,
      at: s.run_at,
      edge: "done",
      ran,
      outcome: { text: tw("today.mcp.row.done", { result: result("changed", s.object_kind === "adset" ? "adset" : "campaign", [s.object_id]) }), tone: "done" },
      ...withUndo(key, s.run_at, [s.object_id], base, later, undos, ctx),
    };
  }
  // Skipped (or an older failed row whose budget changed during the write: MB2 reads it as skipped).
  if (s.status === "skipped" || (s.status === "failed" && reason === "budget_changed")) {
    const skip = SKIP_KEYS[reason ?? ""];
    return { ...empty(), ...head, at: s.run_at, edge: "muted", ran, outcome: { text: tw("today.mcp.row.skipped", { reason: skip ? tw(skip) : tw("today.mcp.skip.unread") }), tone: "muted" } };
  }
  if (s.status === "failed") return { ...empty(), ...head, at: s.run_at, edge: "failed", ran, outcome: { text: tw("today.mcp.row.failed.none"), tone: "failed" } };
  return null;
}

const SKIP_KEYS: Record<string, TodayMetaKey> = {
  budget_changed: "today.mcp.skip.budget_changed",
  paused: "today.mcp.skip.paused",
  ended: "today.mcp.skip.ended",
  ceiling: "today.mcp.skip.ceiling",
  switch: "today.mcp.skip.switch",
  unread: "today.mcp.skip.unread",
};

/** The section header beside the title: "{n} today", then " · {n} scheduled" when any wait (MB2). */
export function headerCount(today: number, waiting: number): string {
  return waiting > 0 ? `${countToday(today)} · ${countScheduled(waiting)}` : countToday(today);
}
