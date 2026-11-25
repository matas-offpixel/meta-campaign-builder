/**
 * lib/mcp/meta/event-write.ts — the one `events` writer in the MCP (M3a,
 * update_event).
 *
 * The event form's save (components/dashboard/events/event-form.tsx →
 * lib/db/events.ts updateEventRow) for five of its fields only:
 * announcement_at, presale_at, general_sale_at (ISO timestamps, as the
 * form's localInputToIso writes them, or null to clear), signup_url and
 * ticket_url (null to clear). updateEventRow's only other step regenerates
 * key moments when event_date changes; update_event never touches
 * event_date, so that step never applies. App database only.
 *
 * Only the caller's own events (events.user_id, the Drive picker's rule).
 * Relative imports only (node:test).
 */
import { ToolInputError, type Db } from "../tool-types.ts";

export const EVENT_EDIT_FIELDS = ["announcement_at", "presale_at", "general_sale_at", "signup_url", "ticket_url"] as const;
export type EventEditField = (typeof EVENT_EDIT_FIELDS)[number];
export type EventPatch = Partial<Record<EventEditField, string | null>>;

export interface EventEditRow {
  id: string;
  user_id: string | null;
  client_id: string | null;
  event_code: string | null;
  announcement_at: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  signup_url: string | null;
  ticket_url: string | null;
}

export const EVENT_EDIT_COLUMNS = "id, user_id, client_id, event_code, announcement_at, presale_at, general_sale_at, signup_url, ticket_url";

/** A timestamp with its zone ("2026-11-27T18:00:00Z", "+00:00"), as the form saves it (toISOString). */
export function normaliseInstant(field: string, value: unknown): string | null {
  if (value === null) return null;
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    throw new ToolInputError(`${field} is a time with its zone, e.g. "2026-11-27T18:00:00Z" (London in winter) or "2027-04-10T10:00:00+01:00" (London in summer), or null to clear it.`, { refused: "bad_time", field });
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new ToolInputError(`${field} isn't a real time.`, { refused: "bad_time", field });
  return d.toISOString();
}

export function normaliseLink(field: string, value: unknown): string | null {
  if (value === null) return null;
  const s = typeof value === "string" ? value.trim() : "";
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new ToolInputError(`${field} is an https link, or null to clear it.`, { refused: "bad_link", field });
  }
  if (url.protocol !== "https:") throw new ToolInputError(`${field} must start with https://.`, { refused: "bad_link", field });
  return s;
}

/** The event form's update, for the given fields only, guarded on the owner. */
export async function updateEventFields(db: Db, input: { eventId: string; userId: string; patch: EventPatch }): Promise<EventEditRow> {
  const res = await db.from("events").update(input.patch).eq("id", input.eventId).eq("user_id", input.userId).select(EVENT_EDIT_COLUMNS);
  if (res.error) throw new Error(`events update: ${res.error.message}`);
  const row = ((res.data ?? []) as EventEditRow[])[0];
  if (!row) throw new ToolInputError("This event belongs to another account, so it can't be changed from here.", { eventId: input.eventId, refused: "not_owner" });
  return row;
}
