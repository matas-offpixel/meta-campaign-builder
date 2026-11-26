/**
 * lib/mcp/today/undo.ts — Undo and Cancel on Today (FC1, MB1, MB2).
 *
 * Undo is Matas's own action on a row of Claude's changes. It puts back what
 * the change did, through the same paths the live tools use
 * (McpLiveDeps: the status writes, the budget write, the refresh's move, the
 * name write; every write on meta_write_idempotency, keyed "undo:{row}"):
 *   - pause ↔ resume;
 *   - a budget back to what it was (daily or lifetime), a scheduled one too;
 *   - a whole move back (£x a day from the receiving ad set to the giver);
 *   - a rename back;
 *   - a delete of paused objects Claude made: a paused launch's campaign, or
 *     paused ads it added. Status DELETED through the same status writes and
 *     switches. It confirms once on Today (the UI); here `confirmed` must be
 *     true.
 * Before writing, the object is read live and placed in the event's
 * campaign tree again: if it isn't as the change left it ("Changed since, so
 * Undo is off."), nothing is written. An Undo that starts or raises spend
 * (resuming, a budget back up, the giver getting its money back) meets the
 * show's spend ceiling through checkLiveCeiling, the live tools' one ceiling
 * call (lib/mcp/meta/show-ceiling.ts), and reads "Undo refused · {reason}"
 * past it.
 *
 * Every Undo pressed is one mcp_actions row (tool today_undo, kind meta,
 * approval_source today, approved by Matas), through the action log: the
 * row's result names the change it undid (undoOf), what it did, and why not
 * when it didn't. Today draws "Undone by {name} · {date, time}" from it.
 *
 * Cancel stops a scheduled budget change still waiting (cancelScheduled, the
 * same guard as cancel_scheduled in Claude), marked as cancelled on Today.
 *
 * Writes nothing itself: mcp_actions through lib/mcp/action-log.ts,
 * scheduled_meta_changes through lib/mcp/live/scheduled.ts, Meta through
 * McpLiveDeps. Relative imports only (node:test).
 */
import type { ActionLogger } from "../action-log.ts";
import { checkLiveCeiling, liveEvent, placeObject, type LiveEvent, type Placed } from "../live/resolve.ts";
import { cancelScheduled, getScheduled, type ScheduledRow } from "../live/scheduled.ts";
import type { ShowChange } from "../meta/show-ceiling.ts";
import type { LiveKind, LiveObject, McpLiveDeps } from "../live/types.ts";
import { ToolInputError, type Db } from "../tool-types.ts";
import { LOGGED_TOOLS, UNDO_TOOL } from "./log.ts";
import { money, reasonOf, tw } from "./words.ts";

type Json = Record<string, unknown>;

export interface UndoDeps {
  db: Db;
  live: McpLiveDeps;
  userId: string;
  now: Date;
  logger: ActionLogger;
}

/** What one press of Undo did. `reason` is "Undo refused · {reason}"'s {reason}. */
export type UndoResult =
  | { state: "undone" }
  | { state: "off" }
  | { state: "refused"; reason: string; refused: string }
  | { state: "already" }
  | { state: "none" }
  | { state: "confirm" };

type Plan =
  | { op: "status"; kind: LiveKind; id: string; to: "PAUSED" | "ACTIVE"; expect: "PAUSED" | "ACTIVE" }
  | { op: "budget"; kind: "campaign" | "adset"; id: string; field: "daily_budget" | "lifetime_budget"; back: number; expect: number }
  | { op: "move"; giver: string; taker: string; deltaMinor: number; expectGiver: number; expectTaker: number }
  | { op: "rename"; kind: LiveKind; id: string; back: string; expect: string }
  | { op: "delete"; kind: "campaign" | "ad"; ids: string[] };

interface Target {
  key: string;
  code: string | null;
  eventId: string | null;
  clientId: string | null;
  ledgerDraftId: string | null;
  plan: Plan | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const kindOf = (v: unknown): LiveKind => (v === "ad_set" || v === "adset" ? "adset" : v === "ad" ? "ad" : "campaign");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Undo a logged call has, from what its row stored (log.ts draws the same set). */
export function planFor(tool: string, status: string, r: Json, args: Json): Plan | null {
  const id = str(r.objectId);
  if (status === "done" && (r.noop || r.scheduledId)) return null;
  if (tool === "pause" && status === "done" && id) return { op: "status", kind: kindOf(r.kind), id, to: "ACTIVE", expect: "PAUSED" };
  if (tool === "resume" && status === "done" && id) return { op: "status", kind: kindOf(r.kind), id, to: "PAUSED", expect: "ACTIVE" };
  if (tool === "set_budget" && status === "done" && id && num(r.before) != null && num(r.after) != null) {
    return { op: "budget", kind: kindOf(r.kind) === "adset" ? "adset" : "campaign", id, field: r.field === "lifetime_budget" ? "lifetime_budget" : "daily_budget", back: num(r.before)!, expect: num(r.after)! };
  }
  if (tool === "move_budget" && status === "done") {
    const plan = (r.plan ?? null) as { from?: { after?: number }; to?: { after?: number } } | null;
    const from = str(r.fromAdsetId);
    const to = str(r.toAdsetId);
    const delta = num(r.deltaMinor);
    if (from && to && delta && plan?.from?.after != null && plan?.to?.after != null) return { op: "move", giver: to, taker: from, deltaMinor: delta, expectGiver: plan.to.after, expectTaker: plan.from.after };
    return null;
  }
  if (tool === "rename" && status === "done" && id && str(r.before) && str(r.after)) return { op: "rename", kind: kindOf(r.kind), id, back: str(r.before)!, expect: str(r.after)! };
  if (tool === "add_creatives_to_stage" && status === "done" && r.live !== true && list(r.adIds).length && list(r.missed).length === 0) return { op: "delete", kind: "ad", ids: list(r.adIds) };
  if (tool === "launch_draft" && (str(r.mode) ?? str(args.mode)) !== "live" && str(r.metaCampaignId) && (status === "done" || r.refused === "launch_partial")) return { op: "delete", kind: "campaign", ids: [str(r.metaCampaignId)!] };
  return null;
}

async function loadTarget(db: Db, userId: string, key: string): Promise<Target | null> {
  if (key.startsWith("scheduled:")) {
    const id = key.slice("scheduled:".length);
    if (!UUID.test(id)) return null;
    const row: ScheduledRow | null = await getScheduled(db, { userId, id });
    if (!row || row.status !== "applied") return null;
    const before = num((row.outcome as Json | null)?.before) ?? (row.expected_minor == null ? null : Number(row.expected_minor));
    const ev = row.event_id ? await db.from("events").select("id, event_code").eq("id", row.event_id).maybeSingle() : { data: null, error: null };
    return {
      key,
      code: ((ev.data as { event_code?: string } | null)?.event_code) ?? null,
      eventId: row.event_id,
      clientId: row.client_id,
      ledgerDraftId: row.ledger_draft_id,
      plan: before == null ? null : { op: "budget", kind: row.object_kind, id: row.object_id, field: row.field, back: before, expect: Number(row.amount_minor) },
    };
  }
  if (!UUID.test(key)) return null;
  const res = await db.from("mcp_actions").select("id, user_id, tool, status, kind, args, result, event_id, client_id").eq("id", key).eq("user_id", userId).maybeSingle();
  const a = res.error ? null : (res.data as Json | null);
  if (!a || a.kind !== "meta" || !(LOGGED_TOOLS as readonly string[]).includes(String(a.tool))) return null;
  const r = (a.result ?? {}) as Json;
  const args = (a.args ?? {}) as Json;
  return {
    key,
    code: str(r.code) ?? str(args.event),
    eventId: str(a.event_id),
    clientId: str(a.client_id),
    ledgerDraftId: str(r.ledgerDraftId) ?? str(r.draftId),
    plan: planFor(String(a.tool), String(a.status), r, args),
  };
}

async function alreadyUndone(db: Db, userId: string, key: string): Promise<boolean> {
  const res = await db.from("mcp_actions").select("status, result").eq("user_id", userId).eq("tool", UNDO_TOOL).eq("status", "done").range(0, 499);
  if (res.error) return false;
  return ((res.data ?? []) as Array<{ result: Json | null }>).some((u) => u.result?.undoOf === key);
}

/** A ceiling refusal's short reason, in the logged refusal rows' words (e.g. "Undo refused · P26-BDAY has no spend ceiling, and this starts or raises spend"). */
function ceilingReason(e: ToolInputError, code: string): { reason: string; refused: string } {
  const s = (e.summary ?? {}) as Json;
  if (s.refused === "over_ceiling") return { refused: "over_ceiling", reason: reasonOf(tw("today.mcp.row.refused", { code, x: money(num(s.committedAfter) ?? 0), c: money(num(s.ceilingGbp) ?? 0) })) };
  if (s.refused === "no_ceiling") return { refused: "no_ceiling", reason: reasonOf(tw("today.mcp.row.refused.none", { code })) };
  return { refused: String(s.refused ?? "ceiling"), reason: reasonOf(tw("today.mcp.row.failed.none")) };
}

const SWITCH_REASON = () => reasonOf(tw("today.mcp.row.refused.switch"));
const META_REASON = () => reasonOf(tw("today.mcp.row.failed.none"));

function switchOn(live: McpLiveDeps, plan: Plan): boolean {
  const s = live.switches();
  if (plan.op === "budget" || plan.op === "move") return s.budget;
  if (plan.op === "rename") return true;
  const kind = plan.kind;
  return kind === "ad" ? s.adStatus : s.adsetStatus;
}

const WRITE_SWITCH_ERRORS = new Set(["BudgetWritesDisabledError", "AdSetStatusWritesDisabledError", "AdStatusWritesDisabledError"]);

/**
 * Run the Undo of one row (an mcp_actions id, or "scheduled:{id}"). Logs one
 * today_undo row for every press that reaches a decision.
 */
export async function runUndo(deps: UndoDeps, key: string, opts: { confirmed?: boolean } = {}): Promise<UndoResult> {
  const started = Date.now();
  const { db, live, userId, now } = deps;
  const target = await loadTarget(db, userId, key);
  if (!target || !target.plan) return { state: "none" };
  if (await alreadyUndone(db, userId, key)) return { state: "already" };
  const plan = target.plan;
  if (plan.op === "delete" && opts.confirmed !== true) return { state: "confirm" };

  const log = async (status: "done" | "failed", out: Json) => {
    await deps.logger
      .log({
        user_id: userId,
        grant_id: null,
        client_id: target.clientId,
        event_id: target.eventId,
        tool: UNDO_TOOL,
        args: { key },
        kind: "meta",
        status,
        result: { undoOf: key, op: plan.op, ...out },
        error: null,
        duration_ms: Date.now() - started,
        result_bytes: 0,
        approvedOnToday: true,
        approved_at: now.toISOString(),
      })
      .catch(() => "stdout");
  };
  const off = async (why: string): Promise<UndoResult> => {
    await log("failed", { refused: "changed", why });
    return { state: "off" };
  };
  const refuse = async (refused: string, reason: string): Promise<UndoResult> => {
    await log("failed", { refused, reason });
    return { state: "refused", refused, reason };
  };

  if (!switchOn(live, plan)) return refuse("switch_off", SWITCH_REASON());
  const undoKey = `undo:${key}`;

  // A delete: each object Claude made, read live, still paused.
  if (plan.op === "delete") {
    if (!target.ledgerDraftId) return off("no_ledger");
    let objects: Map<string, LiveObject>;
    try {
      objects = (await live.readObjects(userId, plan.kind, plan.ids)).objects;
    } catch {
      return refuse("meta_unread", META_REASON());
    }
    for (const id of plan.ids) {
      const o = objects.get(id);
      if (!o || o.status !== "PAUSED" || o.effectiveStatus === "ACTIVE") return off("not_paused");
    }
    const deleted: string[] = [];
    for (const id of plan.ids) {
      try {
        await live.setStatus({ userId, kind: plan.kind, id, status: "DELETED", ledger: { draftId: target.ledgerDraftId, eventId: target.eventId }, key: undoKey });
        deleted.push(id);
      } catch (e) {
        if (e instanceof Error && WRITE_SWITCH_ERRORS.has(e.name)) return refuse("switch_off", SWITCH_REASON());
        await log("failed", { refused: "meta_failed", reason: META_REASON(), deleted });
        return { state: "refused", refused: "meta_failed", reason: META_REASON() };
      }
    }
    await log("done", { deleted });
    return { state: "undone" };
  }

  // Everything else: the event and the object placed in its tree again, as the change left it.
  if (!target.code) return off("no_event");
  let event: LiveEvent;
  try {
    event = await liveEvent({ db, userId }, live, target.code);
  } catch {
    return off("event");
  }
  const place = async (kind: LiveKind, id: string): Promise<Placed | null> => {
    try {
      return await placeObject({ userId }, live, event, kind, id);
    } catch (e) {
      if (e instanceof ToolInputError && e.summary?.refused === "meta_unread") throw e;
      return null;
    }
  };
  const ceiling = async (placed: Placed, change: ShowChange) => {
    await checkLiveCeiling({ db, userId, now }, live, { event, accountId: placed.object.accountId ?? placed.campaign.adAccountId, name: placed.name, change });
  };

  try {
    if (plan.op === "status") {
      const placed = await place(plan.kind, plan.id);
      if (!placed || placed.object.status !== plan.expect) return off("status");
      if (plan.to === "ACTIVE") {
        try {
          await ceiling(placed, { starts: true, objects: plan.kind === "ad" ? [] : [{ kind: plan.kind, id: plan.id, status: "ACTIVE" }] });
        } catch (e) {
          if (e instanceof ToolInputError) {
            const c = ceilingReason(e, event.code);
            return refuse(c.refused, c.reason);
          }
          throw e;
        }
      }
      await live.setStatus({ userId, kind: plan.kind, id: plan.id, status: plan.to, ledger: placed.ledger, key: undoKey });
      await log("done", { kind: plan.kind, id: plan.id, to: plan.to });
      return { state: "undone" };
    }
    if (plan.op === "budget") {
      const placed = await place(plan.kind, plan.id);
      const current = placed ? (plan.field === "daily_budget" ? placed.object.dailyBudgetMinor : placed.object.lifetimeBudgetMinor) : null;
      if (!placed || current !== plan.expect) return off("budget");
      if (plan.back > plan.expect) {
        try {
          await ceiling(placed, { starts: false, objects: [{ kind: plan.kind, id: plan.id, ...(plan.field === "daily_budget" ? { dailyMinor: plan.back } : { lifetimeMinor: plan.back }) }] });
        } catch (e) {
          if (e instanceof ToolInputError) {
            const c = ceilingReason(e, event.code);
            return refuse(c.refused, c.reason);
          }
          throw e;
        }
      }
      await live.setBudget({ userId, kind: plan.kind, id: plan.id, field: plan.field, minor: plan.back, expectedMinor: plan.expect, liveMinor: current, ledger: placed.ledger, key: undoKey });
      await log("done", { kind: plan.kind, id: plan.id, field: plan.field, minor: plan.back });
      return { state: "undone" };
    }
    if (plan.op === "move") {
      const giver = await place("adset", plan.giver);
      const taker = await place("adset", plan.taker);
      if (!giver || !taker || giver.object.dailyBudgetMinor !== plan.expectGiver || taker.object.dailyBudgetMinor !== plan.expectTaker) return off("budget");
      try {
        await ceiling(taker, {
          starts: false,
          objects: [
            { kind: "adset", id: plan.giver, dailyMinor: plan.expectGiver - plan.deltaMinor },
            { kind: "adset", id: plan.taker, dailyMinor: plan.expectTaker + plan.deltaMinor },
          ],
        });
      } catch (e) {
        if (e instanceof ToolInputError) {
          const c = ceilingReason(e, event.code);
          return refuse(c.refused, c.reason);
        }
        throw e;
      }
      const out = await live.moveBudget({ userId, fromAdsetId: plan.giver, toAdsetId: plan.taker, deltaMinor: plan.deltaMinor, campaignId: giver.campaign.metaCampaignId, ledger: giver.ledger, key: undoKey });
      if (out.state !== "applied") {
        if (out.stop === "underfoot") return off("budget");
        await log("failed", { refused: "meta_failed", reason: META_REASON(), written: out.written });
        return { state: "refused", refused: "meta_failed", reason: META_REASON() };
      }
      await log("done", { from: plan.giver, to: plan.taker, deltaMinor: plan.deltaMinor });
      return { state: "undone" };
    }
    // rename
    const placed = await place(plan.kind, plan.id);
    if (!placed || placed.object.name !== plan.expect) return off("name");
    await live.rename({ userId, kind: plan.kind, id: plan.id, name: plan.back, ledger: placed.ledger, key: undoKey });
    await log("done", { kind: plan.kind, id: plan.id });
    return { state: "undone" };
  } catch (e) {
    if (e instanceof Error && e.name === "BudgetChangedUnderfootError") return off("budget");
    if (e instanceof Error && WRITE_SWITCH_ERRORS.has(e.name)) return refuse("switch_off", SWITCH_REASON());
    return refuse("meta_failed", META_REASON());
  }
}

/** Cancel on Today (MB2): the same guard as cancel_scheduled, marked as cancelled on Today. */
export async function cancelFromToday(db: Db, input: { userId: string; id: string; now: Date }): Promise<{ state: "cancelled" | "not_scheduled" | "none" }> {
  if (!UUID.test(input.id)) return { state: "none" };
  const res = await cancelScheduled(db, { userId: input.userId, id: input.id, now: input.now, by: "today" });
  if (res.cancelled) return { state: "cancelled" };
  return { state: res.row ? "not_scheduled" : "none" };
}
