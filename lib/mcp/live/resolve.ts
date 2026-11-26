/**
 * lib/mcp/live/resolve.ts — the live tools' shared reads (M3b).
 *
 *   - liveEvent: the event by code, the caller's own (events.user_id), with
 *     its campaign tree (lib/campaign-tree/load.ts loadCampaignTree: the
 *     event's campaigns, each with its published draft and ad account). The
 *     tree is the live tools' map of what's theirs: a change reaches only a
 *     campaign, ad set or ad in one of the event's campaigns, and only
 *     through that campaign's published draft (the write ledger is per
 *     draft, RC10's rule on the tree).
 *   - placeObject: a Meta object read live, placed in the tree.
 *   - moneyADay: an object's money a day now (daily budget; lifetime:
 *     remaining ÷ days left in London).
 *   - callKey: the ledger key of one ask (the tool, its arguments and the
 *     chat yes), so a retry of the same ask is a no-op on the ledger.
 *
 * Relative imports only (node:test).
 */
import { createHash } from "node:crypto";
import { loadCampaignTree, type LoadedTree, type TreeDb } from "../../campaign-tree/load.ts";
import type { TreeCampaign } from "../../campaign-tree/tree.ts";
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { checkSpendCeiling } from "../meta/ceiling.ts";
import { EVENT_WORDS } from "../meta/words.ts";
import { ToolInputError, type ToolContext } from "../tool-types.ts";
import { clientNameOf, loadEventByCode, normaliseCode } from "../tools/shared.ts";
import type { LedgerRef, LiveKind, LiveObject, McpLiveDeps } from "./types.ts";
import { LIVE_THINGS, LIVE_WORDS } from "./words.ts";

export interface LiveEvent {
  id: string;
  code: string;
  clientId: string | null;
  clientName: string | null;
  tree: LoadedTree;
}

export function requireLive(ctx: ToolContext): McpLiveDeps {
  if (!ctx.live) throw new ToolInputError(LIVE_WORDS.notWired, { refused: "live_unwired" });
  return ctx.live;
}

/** The event by code, the caller's own, with its campaign tree read live. */
export async function liveEvent(ctx: Pick<ToolContext, "db" | "userId">, live: McpLiveDeps, codeArg: unknown): Promise<LiveEvent> {
  let code: string;
  try {
    code = normaliseCode(codeArg);
  } catch {
    throw new ToolInputError(EVENT_WORDS.refusedCode, { refused: "bad_code" });
  }
  const found = await loadEventByCode(ctx.db, code);
  if (!found) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code), { code, refused: "event_not_found" });
  const owner = await ctx.db.from("events").select("id, user_id").eq("id", found.primary.id).maybeSingle();
  if (owner.error || !owner.data) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code), { code, refused: "event_not_found" });
  if ((owner.data as { user_id: string | null }).user_id !== ctx.userId) throw new ToolInputError(EVENT_WORDS.refusedOtherAccount, { code, refused: "not_owner" });
  const tree = await loadCampaignTree(ctx.db as unknown as TreeDb, { readCampaigns: (ids) => live.readCampaigns(ctx.userId, ids) }, found.primary.id);
  if (!tree) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code), { code, refused: "event_not_found" });
  return { id: found.primary.id, code: found.primary.event_code ?? code, clientId: found.primary.client_id, clientName: clientNameOf(found.primary), tree };
}

export interface Placed {
  object: LiveObject;
  campaign: TreeCampaign;
  ledger: LedgerRef;
  name: string;
}

const META_ID = /^\d{5,32}$/;

/** Meta's limit on campaign, ad set and ad names (lib/meta/object-name-write.ts has the same). */
export const MAX_META_NAME = 400;

export function metaId(value: unknown, kind: LiveKind): string {
  const id = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!META_ID.test(id)) throw new ToolInputError(LIVE_WORDS.notFound(LIVE_THINGS[kind][0], id || "?"), { refused: "bad_id", kind });
  return id;
}

/** Reads one object live and places it in the event's tree; refuses anything outside it. */
export async function placeObject(ctx: Pick<ToolContext, "userId">, live: McpLiveDeps, event: LiveEvent, kind: LiveKind, id: string): Promise<Placed> {
  let read: Awaited<ReturnType<McpLiveDeps["readObjects"]>>;
  try {
    read = await live.readObjects(ctx.userId, kind, [id]);
  } catch {
    throw new ToolInputError(LIVE_WORDS.readFailed, { refused: "meta_unread", kind, id });
  }
  const object = read.objects.get(id);
  const thing = LIVE_THINGS[kind][0];
  if (!object) throw new ToolInputError(LIVE_WORDS.notFound(thing, id), { refused: "not_found", kind, id });
  const campaignId = kind === "campaign" ? object.id : object.campaignId;
  const campaign = event.tree.campaigns.find((c) => c.metaCampaignId === campaignId);
  if (!campaign) throw new ToolInputError(LIVE_WORDS.notOnEvent(thing, id, event.code), { refused: "not_on_event", kind, id, code: event.code });
  const name = object.name || id;
  if (!campaign.draftId) throw new ToolInputError(LIVE_WORDS.noDraft(campaign.name, event.code), { refused: "no_draft", kind, id, campaignId });
  const account = normalizeAdAccountId(object.accountId);
  if (account && campaign.adAccountId && account !== campaign.adAccountId) {
    throw new ToolInputError(LIVE_WORDS.otherAccount(name, account, event.code), { refused: "other_ad_account", kind, id });
  }
  if (object.status === "DELETED" || object.status === "ARCHIVED" || object.effectiveStatus === "DELETED" || object.effectiveStatus === "ARCHIVED") {
    throw new ToolInputError(LIVE_WORDS.gone(name), { refused: "gone", kind, id });
  }
  return { object, campaign, ledger: { draftId: campaign.draftId, eventId: event.id }, name };
}

/**
 * "Thu 26 Nov, 18:00": the weekday, day and month, then the 24-hour time, in
 * London (design's verdict, 26 Nov). The weekday comes from the same instant
 * in Europe/London as the date, never from UTC, so a late-evening or BST
 * time can't slip a day.
 */
export function londonWhen(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

const londonDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Days left in London, today included: the end's London date − today's + 1 (at least 1). */
export function londonDaysLeft(endIso: string | null, now: Date): number | null {
  if (!endIso) return null;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= now.getTime()) return 0;
  const a = Date.parse(`${londonDate(now)}T12:00:00Z`);
  const b = Date.parse(`${londonDate(end)}T12:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Money a day now, in the account's major unit: the daily budget, or a lifetime budget's remaining ÷ days left (London). Null when the budget isn't on this object. */
export function moneyADay(o: Pick<LiveObject, "dailyBudgetMinor" | "lifetimeBudgetMinor" | "budgetRemainingMinor" | "endTime">, now: Date): number | null {
  if (o.dailyBudgetMinor != null && o.dailyBudgetMinor > 0) return round2(o.dailyBudgetMinor / 100);
  if (o.lifetimeBudgetMinor != null && o.lifetimeBudgetMinor > 0) {
    const remaining = (o.budgetRemainingMinor ?? o.lifetimeBudgetMinor) / 100;
    const days = londonDaysLeft(o.endTime, now);
    if (days == null) return round2(remaining);
    if (days === 0) return 0;
    return round2(remaining / days);
  }
  return null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A spend-starting or spend-raising change: the client's ceiling against
 * `gbp`, the money a day the change sets running (M3a's basis: the change's
 * own money a day). An account not in £ is refused (ceilings are in £).
 */
export async function checkLiveCeiling(ctx: Pick<ToolContext, "db" | "userId">, live: McpLiveDeps, input: { event: LiveEvent; accountId: string | null; name: string; gbp: number }): Promise<{ ceilingGbp: number; moneyGbp: number; currency: string }> {
  let currency = "GBP";
  if (input.accountId) {
    try {
      currency = ((await live.accountInfo(ctx.userId, input.accountId)).currency ?? "GBP").toUpperCase();
    } catch {
      throw new ToolInputError(LIVE_WORDS.readFailed, { refused: "account_unread" });
    }
  }
  if (currency !== "GBP") throw new ToolInputError(LIVE_WORDS.currency(input.name, currency), { refused: "not_gbp", currency });
  const checked = await checkSpendCeiling(ctx.db, { clientId: input.event.clientId, clientName: input.event.clientName, money: { gbp: input.gbp, basis: "ad_set_daily", days: null, currency: "GBP" } });
  return { ...checked, currency };
}

/**
 * A refusal thrown inside `run` keeps the change's own summary (code, name,
 * before and after) beside its reason, so Today can draw the refused row's
 * change line (FC1: refusals are logged muted, with their short reason).
 */
export async function withBase<T>(base: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ToolInputError) throw new ToolInputError(e.message, { ...base, ...(e.summary ?? {}) }, e.data);
    throw e;
  }
}

/** The ledger key of one ask: the tool, its arguments (without the approval) and the chat yes. A retry of the same ask gives the same key. */
export function callKey(tool: string, args: Record<string, unknown>, approval: { asked: string; answer: string }): string {
  const { approval: _ignored, ...rest } = args;
  void _ignored;
  return createHash("sha256").update(JSON.stringify([tool, stable(rest), approval.asked, approval.answer])).digest("hex").slice(0, 32);
}

/** A UUID made from a key (the tree's run id must be a UUID; a retry gives the same run). */
export function keyUuid(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}

/** Meta's error, never: the tools tell Claude LIVE_WORDS.metaFailed and keep this short reason for mcp_actions. */
export function errorReason(e: unknown): string {
  const name = e instanceof Error ? e.name : "error";
  return name.slice(0, 60);
}
