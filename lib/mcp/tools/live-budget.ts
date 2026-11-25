/**
 * lib/mcp/tools/live-budget.ts — set_budget, move_budget, list_scheduled
 * and cancel_scheduled (M3b, scope mcp:meta, Matas only).
 *
 * set_budget: one live campaign's or ad set's daily or lifetime budget,
 * through the optimisation budget write (McpLiveDeps.setBudget,
 * ENABLE_OPTIMISATION_WRITES). Up is spend-raising: the client's ceiling is
 * checked against the money a day it sets running. With `at` the change is
 * stored (scheduled_meta_changes, lib/mcp/live/scheduled.ts) with the chat
 * yes and applied by the 15-minute cron, ceiling checked again then, and
 * skipped if the object changed since.
 *
 * move_budget: money a day from one ad set to another in the same campaign,
 * through the on-sale refresh's move (moveAdSetDailyBudget): the giving side
 * first, each side written only from the budget it was read at. A retry of
 * the same ask reuses the plan its first try stored, so a side is never
 * moved twice.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { MCP_WORDS, RESULT_WORDS } from "../meta/words.ts";
import { callKey, checkLiveCeiling, errorReason, liveEvent, londonWhen, metaId, placeObject, requireLive, round2 } from "../live/resolve.ts";
import { cancelScheduled, insertScheduled, listScheduled, moneyAfter, type ScheduledRow } from "../live/scheduled.ts";
import type { MovePlanLite } from "../live/types.ts";
import { LIVE_THINGS, LIVE_WORDS } from "../live/words.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";
import { requireMetaScope } from "./live-read.ts";

const MAX_GBP = 100_000;
const MIN_LEAD_MS = 15 * 60_000;
const MAX_AHEAD_MS = 60 * 86_400_000;
const ZONED = /(Z|[+-]\d{2}:?\d{2})$/;

function amountMinor(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > MAX_GBP) throw new ToolInputError(LIVE_WORDS.budgetAmount, { refused: "bad_amount" });
  return Math.round(n * 100);
}

export function parseAt(v: unknown, now: Date): string | null {
  if (v == null || v === "") return null;
  const s = typeof v === "string" ? v.trim() : "";
  const t = Date.parse(s);
  if (!ZONED.test(s) || Number.isNaN(t) || t < now.getTime() + MIN_LEAD_MS || t > now.getTime() + MAX_AHEAD_MS) throw new ToolInputError(LIVE_WORDS.schedulePast, { refused: "bad_at" });
  return new Date(t).toISOString();
}

export const setBudgetTool: McpTool = {
  name: "set_budget",
  title: "Change a live campaign's or ad set's budget",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: [
    "Sets one live ad set's budget, or a campaign's when the budget is on the campaign, as the app's budget write does. Give daily_gbp for a daily budget or lifetime_gbp for a lifetime one, matching what it runs on (get_live shows it). Amounts are in the account's currency; ceilings are in £.",
    "Raising it raises spend, so it's refused over the client's daily ceiling (and without one). at (a time with its zone, at least 15 minutes ahead) schedules it instead: it runs then only if the budget, status and end are as they are now, and the ceiling is checked again.",
    "Needs Matas's yes in this chat: ask him the name, the budget before → after and when, then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    kind: z.enum(["campaign", "ad_set"]).describe("campaign or ad_set."),
    id: z.string().min(5).max(32).describe("The Meta id, from get_live."),
    daily_gbp: z.number().optional().describe("The new daily budget, e.g. 40."),
    lifetime_gbp: z.number().optional().describe("The new lifetime budget."),
    at: z.string().max(40).optional().describe('When to make the change, with its zone, e.g. "2026-11-27T18:00:00Z". Omit to change it now.'),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const live = requireLive(ctx);
    const kind = args.kind === "ad_set" ? "adset" : "campaign";
    const id = metaId(args.id, kind);
    const hasDaily = args.daily_gbp != null;
    const hasLifetime = args.lifetime_gbp != null;
    if (hasDaily === hasLifetime) throw new ToolInputError(LIVE_WORDS.budgetAmount, { refused: "bad_amount" });
    const field = hasDaily ? "daily_budget" : "lifetime_budget";
    const minor = amountMinor(hasDaily ? args.daily_gbp : args.lifetime_gbp);
    const at = parseAt(args.at, ctx.now);
    if (!live.switches().budget) throw new ToolInputError(LIVE_WORDS.refusedSwitch, { refused: "switch_off", kind, id });

    const event = await liveEvent(ctx, live, args.event);
    const placed = await placeObject(ctx, live, event, kind, id);
    const { object, name } = placed;
    if (object.endTime && Date.parse(object.endTime) <= ctx.now.getTime()) throw new ToolInputError(LIVE_WORDS.ended(name, object.endTime.slice(0, 10)), { refused: "ended", kind, id });
    const daily = object.dailyBudgetMinor != null && object.dailyBudgetMinor > 0 ? object.dailyBudgetMinor : null;
    const lifetime = object.lifetimeBudgetMinor != null && object.lifetimeBudgetMinor > 0 ? object.lifetimeBudgetMinor : null;
    if (daily == null && lifetime == null) {
      throw new ToolInputError(kind === "adset" ? LIVE_WORDS.ownBudgetCampaign(name) : LIVE_WORDS.ownBudgetAdSets(name), { refused: "budget_elsewhere", kind, id });
    }
    if ((field === "daily_budget" && daily == null) || (field === "lifetime_budget" && lifetime == null)) {
      throw new ToolInputError(LIVE_WORDS.budgetType(name, lifetime != null), { refused: "budget_type", kind, id });
    }
    const current = (field === "daily_budget" ? daily : lifetime)!;
    const isLifetime = field === "lifetime_budget";
    const base = { code: event.code, kind, objectId: id, field, before: current, after: minor, ...(at ? { at } : {}) };
    if (current === minor) {
      return { data: { message: LIVE_WORDS.budgetSame(name, minor / 100, isLifetime), changed: false }, eventId: event.id, clientId: event.clientId, summary: { ...base, noop: "same" } };
    }
    const raises = minor > current;
    const ceiling = raises
      ? await checkLiveCeiling(ctx, live, { event, accountId: object.accountId ?? placed.campaign.adAccountId, name, gbp: moneyAfter(object, field, minor, ctx.now) })
      : null;
    const change = LIVE_WORDS.budgetChange(name, current / 100, minor / 100, isLifetime);
    const key = callKey("set_budget", args, approval);

    if (at) {
      let row: ScheduledRow;
      try {
        row = await insertScheduled(ctx.db, {
          user_id: ctx.userId,
          event_id: event.id,
          client_id: event.clientId,
          kind: "set_budget",
          object_kind: kind,
          object_id: id,
          object_name: name,
          field,
          amount_minor: minor,
          expected_minor: current,
          currency: "GBP",
          raises_spend: raises,
          run_at: at,
          ledger_draft_id: placed.ledger.draftId,
          call_key: key,
          approval_asked: approval.asked,
          approval_answer: approval.answer,
        });
      } catch (e) {
        throw new ToolInputError(LIVE_WORDS.metaFailed, { ...base, refused: "schedule_unwritable", error: errorReason(e) });
      }
      return {
        data: { message: LIVE_WORDS.scheduled(change, londonWhen(at), row.id), scheduled_id: row.id, change },
        eventId: event.id,
        clientId: event.clientId,
        summary: { ...base, scheduledId: row.id, key, raises, ...(ceiling ? { ceiling } : {}) },
      };
    }

    try {
      await live.setBudget({ userId: ctx.userId, kind, id, field, minor, expectedMinor: current, liveMinor: current, ledger: placed.ledger, key });
    } catch (e) {
      if (e instanceof Error && e.name === "BudgetChangedUnderfootError") throw new ToolInputError(LIVE_WORDS.underfoot(name, ((e as { live?: number }).live ?? 0) / 100), { ...base, refused: "underfoot" });
      if (e instanceof Error && e.name === "BudgetWritesDisabledError") throw new ToolInputError(LIVE_WORDS.refusedSwitch, { ...base, refused: "switch_off" });
      throw new ToolInputError(LIVE_WORDS.metaFailed, { ...base, refused: "meta_failed", error: errorReason(e) });
    }
    return {
      data: { message: MCP_WORDS.done(RESULT_WORDS.changed(LIVE_THINGS[kind], [id])), change },
      eventId: event.id,
      clientId: event.clientId,
      summary: { ...base, key, raises, ...(ceiling ? { ceiling } : {}), undo: { tool: "set_budget", kind, id, field, minor: current, ...(isLifetime ? {} : { words: LIVE_WORDS.undoBudget(current / 100) }) } },
    };
  },
};

function scheduledLine(row: ScheduledRow) {
  const lifetime = row.field === "lifetime_budget";
  const before = row.expected_minor == null ? null : Number(row.expected_minor) / 100;
  return {
    id: row.id,
    name: row.object_name ?? row.object_id,
    kind: row.object_kind === "adset" ? "ad_set" : "campaign",
    object_id: row.object_id,
    change: LIVE_WORDS.budgetChange(row.object_name ?? row.object_id, before ?? 0, Number(row.amount_minor) / 100, lifetime),
    at: row.run_at,
    when: londonWhen(row.run_at),
    state: LIVE_WORDS.state[row.status] ?? row.status,
    ...(row.status === "skipped" || row.status === "failed" ? { why: LIVE_WORDS.skip[String(row.outcome?.reason ?? "")] ?? LIVE_WORDS.metaFailed } : {}),
  };
}

export const listScheduledTool: McpTool = {
  name: "list_scheduled",
  title: "List an event's scheduled budget changes",
  kind: "meta",
  readOnly: true,
  idempotent: true,
  description: "Lists the budget changes set_budget scheduled for an event: each one's change, when (London), and whether it's scheduled, applied, skipped (with why), cancelled or failed. Read only.",
  inputSchema: { event: z.string().min(2).max(40).describe("The event code.") },
  async run(ctx, args) {
    requireMetaScope(ctx);
    const live = requireLive(ctx);
    const event = await liveEvent(ctx, live, args.event);
    const rows = await listScheduled(ctx.db, { userId: ctx.userId, eventId: event.id }).catch(() => {
      throw new ToolInputError(LIVE_WORDS.readFailed, { refused: "scheduled_unreadable" });
    });
    return { data: { event: event.code, changes: rows.map(scheduledLine) }, eventId: event.id, clientId: event.clientId, summary: { code: event.code, rows: rows.length } };
  },
};

export const cancelScheduledTool: McpTool = {
  name: "cancel_scheduled",
  title: "Cancel a scheduled budget change",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: "Cancels one change set_budget scheduled, before it runs (id from list_scheduled). Nothing goes to Meta. Needs Matas's yes in this chat, as the other Meta tools do.",
  inputSchema: { id: z.string().uuid().describe("The scheduled change's id."), approval: approvalInput },
  async run(ctx, args) {
    requireMetaApproval(ctx, args);
    const id = String(args.id);
    let res: Awaited<ReturnType<typeof cancelScheduled>>;
    try {
      res = await cancelScheduled(ctx.db, { userId: ctx.userId, id, now: ctx.now });
    } catch {
      throw new ToolInputError(LIVE_WORDS.readFailed, { refused: "scheduled_unreadable", id });
    }
    if (!res.row) throw new ToolInputError(LIVE_WORDS.cancelUnknown(id), { refused: "not_found", id });
    const line = scheduledLine(res.row);
    if (!res.cancelled) {
      if (res.row.status === "cancelled") return { data: { message: LIVE_WORDS.cancelled(line.change, line.when), changed: false }, eventId: res.row.event_id, clientId: res.row.client_id, summary: { id, noop: "already_cancelled" } };
      throw new ToolInputError(LIVE_WORDS.cancelState(id, line.state), { refused: "not_scheduled", id, status: res.row.status });
    }
    return { data: { message: LIVE_WORDS.cancelled(line.change, line.when) }, eventId: res.row.event_id, clientId: res.row.client_id, summary: { id, cancelled: true } };
  },
};

/** The plan an earlier try of this same ask stored on its mcp_actions row, and whether it finished. */
async function earlierTry(ctx: ToolContext, key: string): Promise<{ done: boolean; plan: MovePlanLite | null }> {
  const res = await ctx.db.from("mcp_actions").select("status, result, created_at").eq("user_id", ctx.userId).eq("tool", "move_budget").order("created_at", { ascending: false }).limit(100);
  if (res.error) return { done: false, plan: null };
  for (const row of (res.data ?? []) as Array<{ status: string; result: Record<string, unknown> | null }>) {
    if (row.result?.key !== key) continue;
    if (row.status === "done") return { done: true, plan: (row.result.plan as MovePlanLite) ?? null };
    if (row.result.plan) return { done: false, plan: row.result.plan as MovePlanLite };
  }
  return { done: false, plan: null };
}

export const moveBudgetTool: McpTool = {
  name: "move_budget",
  title: "Move money a day between two ad sets in one campaign",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: [
    "Moves an amount a day from one ad set's daily budget to another's in the same campaign, as the on-sale refresh's move does: the giving ad set first, so spend never goes up mid-move, and neither side written if its budget changed since it was read. The giving ad set keeps at least £1.00 a day.",
    "The receiving ad set's new budget is checked against the client's daily ceiling.",
    "Needs Matas's yes in this chat: ask him the amount a day, from → to, then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    from_ad_set: z.string().min(5).max(32).describe("The ad set that gives."),
    to_ad_set: z.string().min(5).max(32).describe("The ad set that receives."),
    gbp_a_day: z.number().describe("The amount a day to move, e.g. 10."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const live = requireLive(ctx);
    const fromId = metaId(args.from_ad_set, "adset");
    const toId = metaId(args.to_ad_set, "adset");
    if (fromId === toId) throw new ToolInputError(LIVE_WORDS.moveSame, { refused: "same_ad_set" });
    const delta = amountMinor(args.gbp_a_day);
    if (!live.switches().budget) throw new ToolInputError(LIVE_WORDS.refusedSwitch, { refused: "switch_off" });
    const key = callKey("move_budget", args, approval);
    const earlier = await earlierTry(ctx, key);

    const event = await liveEvent(ctx, live, args.event);
    const from = await placeObject(ctx, live, event, "adset", fromId);
    const to = await placeObject(ctx, live, event, "adset", toId);
    const x = delta / 100;
    const change = LIVE_WORDS.changeMove(x, from.name, to.name);
    const base = { code: event.code, fromAdsetId: fromId, toAdsetId: toId, deltaMinor: delta, campaignId: from.campaign.metaCampaignId, key };
    if (earlier.done) {
      return { data: { message: MCP_WORDS.done(RESULT_WORDS.changed(LIVE_THINGS.adset, [fromId, toId])), change, changed: false }, eventId: event.id, clientId: event.clientId, summary: { ...base, noop: "already_moved", plan: earlier.plan } };
    }
    if (from.campaign.metaCampaignId !== to.campaign.metaCampaignId) throw new ToolInputError(LIVE_WORDS.moveSameCampaign, { ...base, refused: "different_campaigns" });
    const fromDaily = from.object.dailyBudgetMinor;
    const toDaily = to.object.dailyBudgetMinor;
    if (!fromDaily || !toDaily) throw new ToolInputError(LIVE_WORDS.moveNotDaily, { ...base, refused: "not_daily" });
    if (!earlier.plan && fromDaily - delta < 100) throw new ToolInputError(LIVE_WORDS.moveFloor(from.name), { ...base, refused: "floor" });
    const ceiling = await checkLiveCeiling(ctx, live, { event, accountId: to.object.accountId ?? to.campaign.adAccountId, name: to.name, gbp: round2((earlier.plan?.to.after ?? toDaily + delta) / 100) });

    let out: Awaited<ReturnType<NonNullable<ToolContext["live"]>["moveBudget"]>>;
    try {
      out = await live.moveBudget({ userId: ctx.userId, fromAdsetId: fromId, toAdsetId: toId, deltaMinor: delta, campaignId: from.campaign.metaCampaignId, ledger: from.ledger, key, previous: earlier.plan });
    } catch (e) {
      throw new ToolInputError(LIVE_WORDS.metaFailed, { ...base, refused: "meta_failed", error: errorReason(e) });
    }
    if (out.state === "failed") {
      const summary = { ...base, refused: out.stop ?? "failed", plan: out.plan ?? null, written: out.written };
      if (out.written.length > 0) throw new ToolInputError(LIVE_WORDS.movePartial(from.name, to.name, x), summary);
      if (out.stop === "floor") throw new ToolInputError(LIVE_WORDS.moveFloor(from.name), summary);
      if (out.stop === "not_daily") throw new ToolInputError(LIVE_WORDS.moveNotDaily, summary);
      if (out.stop === "not_in_campaign") throw new ToolInputError(LIVE_WORDS.moveSameCampaign, summary);
      if (out.stop === "underfoot") throw new ToolInputError(LIVE_WORDS.underfoot(from.name, fromDaily / 100), summary);
      throw new ToolInputError(LIVE_WORDS.metaFailed, summary);
    }
    return {
      data: { message: MCP_WORDS.done(RESULT_WORDS.changed(LIVE_THINGS.adset, [fromId, toId])), change },
      eventId: event.id,
      clientId: event.clientId,
      summary: { ...base, plan: out.plan ?? null, written: out.written, ceiling, undo: { tool: "move_budget", from_ad_set: toId, to_ad_set: fromId, gbp_a_day: x, words: LIVE_WORDS.undoMove(x, from.name) } },
    };
  },
};
