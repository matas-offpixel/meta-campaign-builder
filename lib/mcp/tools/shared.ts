/**
 * lib/mcp/tools/shared.ts
 *
 * Event lookup shared by the MCP tools. Reads go through the existing paged
 * reader (lib/db/paged-read.ts), the archived-client helpers
 * (lib/db/client-status.ts) and the one phase function (phaseOf, §9.7).
 * Relative imports only (node:test).
 */
import { loadAllPaged } from "../../db/paged-read.ts";
import { dropArchivedClientRows, loadArchivedClientIds } from "../../db/client-status.ts";
import { phaseOf, type Phase } from "../../learning/findings/phase.ts";
import { isShowWeek } from "../../onsale-refresh/on-sale.ts";
import { ToolInputError, type Db } from "../tool-types.ts";

export const EVENT_COLUMNS =
  "id, name, event_code, venue_name, venue_city, event_date, announcement_at, presale_at, general_sale_at, status, client_id, meta_campaign_id, client:clients(name)";

export interface EventRow {
  id: string;
  name: string | null;
  event_code: string | null;
  venue_name: string | null;
  venue_city: string | null;
  event_date: string | null;
  announcement_at: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  status: string | null;
  client_id: string | null;
  meta_campaign_id: string | null;
  client: { name: string | null } | Array<{ name: string | null }> | null;
}

export type Stage = Phase | "show_week";

export function clientNameOf(row: EventRow): string | null {
  const c = Array.isArray(row.client) ? row.client[0] : row.client;
  return c?.name ?? null;
}

/** The app's phase (phaseOf), with show week on top of it. */
export function stageOf(row: EventRow, today: string): Stage {
  if (row.event_date && isShowWeek(row.event_date, today)) return "show_week";
  return phaseOf(row, today);
}

export function eventSummary(row: EventRow, today: string) {
  return {
    code: row.event_code,
    name: row.name,
    venue: [row.venue_name, row.venue_city].filter(Boolean).join(", ") || null,
    date: row.event_date,
    phase: stageOf(row, today),
    client: clientNameOf(row),
    status: row.status,
  };
}

/** Events with archived clients dropped (CLAUDE.md "Archived clients"). */
export async function loadEvents(db: Db, filter?: Parameters<typeof loadAllPaged>[4]): Promise<EventRow[]> {
  const rows = await loadAllPaged<EventRow>(db, "events", EVENT_COLUMNS, ["id"], filter, {
    orderBy: [{ column: "event_date", ascending: true, nullsFirst: false }],
  });
  const archived = await loadArchivedClientIds(db as never);
  return dropArchivedClientRows(rows, archived);
}

export function normaliseCode(code: unknown): string {
  const c = typeof code === "string" ? code.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$/.test(c)) throw new ToolInputError("Give an event code such as NX26-DOD.");
  return c;
}

/**
 * One event code can cover sibling fixtures; the owner is the lowest id
 * (lib/db/event-code-primary-sibling.ts). Codes are matched as written,
 * then upper-cased.
 */
export async function loadEventByCode(db: Db, code: string): Promise<{ primary: EventRow; siblings: EventRow[] } | null> {
  let rows = await loadEvents(db, (q) => q.eq("event_code", code));
  if (rows.length === 0 && code.toUpperCase() !== code) rows = await loadEvents(db, (q) => q.eq("event_code", code.toUpperCase()));
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return { primary: sorted[0]!, siblings: sorted.slice(1) };
}
