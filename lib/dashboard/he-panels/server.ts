import "server-only";

/**
 * The reads behind the HE4 and HE6 panels. Figures come only from
 * loadPresaleLog and readObjectiveBudget. A failed read leaves the panel
 * out rather than failing the page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { readObjectiveBudget } from "@/lib/dashboard/objective-budget/read";
import { loadPresaleLog } from "@/lib/dashboard/presale/read";
import { createServiceRoleClient } from "@/lib/supabase/server";

import { budgetPanel, type BudgetPanelModel } from "./budget-view";
import { presalePanel, type PresalePanelModel } from "./presale-view";

type Db = SupabaseClient;
type Surface = "internal" | "share";

export interface EventPanels {
  presale: PresalePanelModel | null;
  budget: BudgetPanelModel | null;
}

export async function loadEventPanels(db: Db, opts: { eventId: string; clientId: string; surface: Surface; presale: boolean; nowMs?: number }): Promise<EventPanels> {
  const nowMs = opts.nowMs ?? Date.now();
  const [presale, budget] = await Promise.all([
    opts.presale ? loadPresale(db, opts.eventId, opts.surface, nowMs) : Promise.resolve(null),
    loadBudget(db, { clientId: opts.clientId, eventId: opts.eventId }, nowMs),
  ]);
  return { presale, budget };
}

/** Share link: service role, after the token has already resolved to this client. */
export function loadShareSalesPanels(clientId: string, showId: string, nowMs = Date.now()): Promise<EventPanels> {
  return loadSalesPanels(createServiceRoleClient(), clientId, showId, "share", nowMs);
}

/** `showId` is the sales view: "all" is the client, a lower-cased event code is one show. */
export async function loadSalesPanels(db: Db, clientId: string, showId: string, surface: Surface, nowMs = Date.now()): Promise<EventPanels> {
  if (showId === "all") return { presale: null, budget: await loadBudget(db, { clientId }, nowMs) };
  const { data, error } = await db.from("events").select("id,event_code,name,kind").eq("client_id", clientId);
  if (error || !data) return { presale: null, budget: null };
  const event = (data as { id: string; event_code: string | null; name: string | null; kind: string | null }[]).find((e) => (e.event_code ?? "").toLowerCase() === showId);
  if (!event) return { presale: null, budget: null };
  return loadEventPanels(db, { eventId: event.id, clientId, surface, presale: event.kind !== "brand_campaign", nowMs });
}

async function loadPresale(db: Db, eventId: string, surface: Surface, nowMs: number): Promise<PresalePanelModel | null> {
  try {
    const log = await loadPresaleLog(db, eventId);
    if (!log) return null;
    const { data } = await db.from("events").select("name").eq("id", eventId).maybeSingle();
    const show = (data as { name: string | null } | null)?.name ?? "This show";
    return presalePanel(log, { show, surface, nowMs });
  } catch (error) {
    console.error("[presale-panel] read failed", error);
    return null;
  }
}

async function loadBudget(db: Db, opts: { clientId: string; eventId?: string }, nowMs: number): Promise<BudgetPanelModel | null> {
  try {
    const result = await readObjectiveBudget(db, { clientId: opts.clientId, eventId: opts.eventId, today: londonToday(nowMs) });
    return result ? budgetPanel(result, nowMs) : null;
  } catch (error) {
    console.error("[objective-budget-panel] read failed", error);
    return null;
  }
}

function londonToday(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
