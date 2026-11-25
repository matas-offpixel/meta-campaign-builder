/**
 * lib/mcp/meta/ceiling.ts — each client's daily ceiling (M3a).
 *
 * client_spend_ceilings (migration 268): one `daily_gbp` per client, set by
 * Matas only (scripts/set-client-ceiling.mts until Settings › Claude ships).
 * A change through the connector that starts or raises spend (a live
 * launch now; resume, budget up and live tests in M3b) is checked here on
 * the server:
 *   - no ceiling for the client → refused;
 *   - over the ceiling → refused;
 * and nothing is sent to Meta. A change that starts no spend (uploads, a
 * paused launch, renames, event edits) never reads a ceiling.
 *
 * launch_draft's figure is the draft's own money a day (the brief: "ceiling
 * = the draft's money a day"), as the launch would set it:
 *   - campaign budget (CBO), daily: budgetAmount;
 *   - campaign budget, lifetime: budgetAmount ÷ scheduled days;
 *   - ad set budgets, daily: the enabled ad sets' budgetPerDay summed;
 *   - ad set budgets, lifetime: their budgetLifetime summed ÷ scheduled days.
 * Scheduled days use the wizard's own count (budget-pacing/plan.ts:
 * ceil((end − start) / day)); with no usable schedule a lifetime budget
 * counts whole, as one day.
 *
 * Relative imports only (node:test).
 */
import type { CampaignDraft } from "../../types.ts";
import { ToolInputError, type Db } from "../tool-types.ts";
import { MCP_WORDS } from "./words.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MoneyADay {
  /** Pounds a day, 2 dp. */
  gbp: number;
  basis: "campaign_daily" | "campaign_lifetime" | "ad_set_daily" | "ad_set_lifetime";
  days: number | null;
  currency: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function scheduledDays(startDate: string | undefined, endDate: string | undefined): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const days = Math.ceil((end - start) / DAY_MS);
  return days > 0 ? days : null;
}

/** The draft's money a day, as a launch of it would spend. */
export function draftMoneyADay(draft: Pick<CampaignDraft, "budgetSchedule" | "adSetSuggestions">): MoneyADay {
  const b = draft.budgetSchedule;
  const level = b?.budgetLevel ?? "ad_set";
  const type = b?.budgetType ?? "daily";
  const days = scheduledDays(b?.startDate, b?.endDate);
  const currency = (b?.currency || "GBP").toUpperCase();
  const enabled = (draft.adSetSuggestions ?? []).filter((s) => s.enabled !== false);
  if (level === "campaign") {
    const amount = num(b?.budgetAmount);
    if (type === "lifetime") return { gbp: round2(amount / (days ?? 1)), basis: "campaign_lifetime", days, currency };
    return { gbp: round2(amount), basis: "campaign_daily", days, currency };
  }
  if (type === "lifetime") {
    const total = enabled.reduce((sum, s) => sum + num((s as { budgetLifetime?: number }).budgetLifetime), 0);
    return { gbp: round2(total / (days ?? 1)), basis: "ad_set_lifetime", days, currency };
  }
  return { gbp: round2(enabled.reduce((sum, s) => sum + num(s.budgetPerDay), 0)), basis: "ad_set_daily", days, currency };
}

export interface Ceiling {
  clientId: string;
  dailyGbp: number;
  setAt: string | null;
}

/** The client's ceiling, or null when none is set. Throws when it can't be read (refuse, never assume). */
export async function loadCeiling(db: Db, clientId: string): Promise<Ceiling | null> {
  const res = await db.from("client_spend_ceilings").select("client_id, daily_gbp, set_at").eq("client_id", clientId).maybeSingle();
  if (res.error) throw new ToolInputError(CEILING_WORDS.unreadable, { refused: "ceiling_unreadable" });
  const row = res.data as { client_id: string; daily_gbp: number | string; set_at: string | null } | null;
  if (!row) return null;
  const daily = Number(row.daily_gbp);
  if (!Number.isFinite(daily) || daily < 0) throw new ToolInputError(CEILING_WORDS.unreadable, { refused: "ceiling_unreadable" });
  return { clientId: row.client_id, dailyGbp: daily, setAt: row.set_at };
}

/** What a ceiling refusal tells Claude: design's rows (claude.mcp.refused, .none, .no_client, .currency, .ceiling_unread). */
export const CEILING_WORDS = {
  none: (client: string) => MCP_WORDS.refusedNoCeiling(client),
  over: (client: string, x: number, c: number) => MCP_WORDS.refusedOverCeiling(client, x, c),
  noClient: MCP_WORDS.refusedNoClient,
  notGbp: (currency: string) => MCP_WORDS.refusedCurrency(currency),
  unreadable: MCP_WORDS.refusedCeilingUnread,
} as const;

/**
 * A spend-starting change: refused unless the client has a ceiling at or
 * above `money`. Returns what was checked, for the action log.
 */
export async function checkSpendCeiling(
  db: Db,
  input: { clientId: string | null; clientName: string | null; money: MoneyADay },
): Promise<{ ceilingGbp: number; moneyGbp: number }> {
  if (!input.clientId) throw new ToolInputError(CEILING_WORDS.noClient, { refused: "no_client" });
  if (input.money.currency !== "GBP") throw new ToolInputError(CEILING_WORDS.notGbp(input.money.currency), { refused: "not_gbp", clientId: input.clientId });
  const name = input.clientName || input.clientId;
  const ceiling = await loadCeiling(db, input.clientId);
  if (!ceiling) throw new ToolInputError(CEILING_WORDS.none(name), { refused: "no_ceiling", clientId: input.clientId, moneyGbp: input.money.gbp });
  if (input.money.gbp > ceiling.dailyGbp) {
    throw new ToolInputError(CEILING_WORDS.over(name, input.money.gbp, ceiling.dailyGbp), {
      refused: "over_ceiling",
      clientId: input.clientId,
      moneyGbp: input.money.gbp,
      ceilingGbp: ceiling.dailyGbp,
    });
  }
  return { ceilingGbp: ceiling.dailyGbp, moneyGbp: input.money.gbp };
}
