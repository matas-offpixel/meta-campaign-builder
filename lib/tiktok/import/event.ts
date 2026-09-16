/**
 * Import must attach an event before it saves. Launch preflight keys
 * write idempotency on event_id; a draft without one cannot relaunch.
 * The operator picks. A unique bracketed code in the campaign name is
 * a default, never a save.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";
import { campaignMatchesBracketedEventCode } from "../../insights/meta-event-code-match.ts";
import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

export const TIKTOK_IMPORT_EVENT_ID_REQUIRED = "event_id is required";
export const TIKTOK_IMPORT_EVENT_ID_CLIENT_MISMATCH =
  "event_id does not belong to this client";
export const TIKTOK_IMPORT_ACCOUNT_NOT_LINKED =
  "This TikTok account is not linked to a client";

export type TikTokImportEventOption = {
  id: string;
  name: string;
  event_code: string | null;
  event_date: string | null;
};

export type TikTokImportEventRow = TikTokImportEventOption & {
  client_id: string;
};

export type TikTokImportEventSuggestion = {
  eventId: string;
  code: string;
};

export function parseTikTokImportEventId(body: {
  eventId?: unknown;
}): string | null {
  if (typeof body.eventId !== "string") return null;
  const id = body.eventId.trim();
  return id ? id : null;
}

/**
 * Exactly one of `events` whose `event_code` is a case-sensitive
 * `[CODE]` substring of the campaign name. Zero or two-or-more is not
 * a suggestion. Do not uppercase — that matcher is case-sensitive on
 * purpose (PR #392).
 */
export function suggestTikTokImportEvent(
  campaignName: string,
  events: ReadonlyArray<{ id: string; event_code?: string | null }>,
): TikTokImportEventSuggestion | null {
  const matches = events.filter((event) => {
    const code = event.event_code?.trim();
    if (!code) return false;
    return campaignMatchesBracketedEventCode(campaignName, code);
  });
  if (matches.length !== 1) return null;
  const event = matches[0]!;
  return { eventId: event.id, code: event.event_code!.trim() };
}

export function formatTikTokImportEventSuggestion(code: string): string {
  return `matched [${code}] in the campaign name — change if wrong`;
}

export function formatTikTokImportEventOptionLabel(
  event: TikTokImportEventOption,
): string {
  const code = event.event_code?.trim();
  const prefix = code ? `[${code}] ` : "";
  const date = event.event_date ? ` · ${event.event_date}` : "";
  return `${prefix}${event.name}${date}`;
}

export function eventBelongsToClient<T extends { client_id: string }>(
  event: T | null,
  clientId: string | null,
): event is T {
  if (!event || !clientId) return false;
  return event.client_id === clientId;
}

export function attachTikTokImportEvent(
  draft: TikTokCampaignDraft,
  event: Pick<TikTokImportEventRow, "id" | "event_code">,
): TikTokCampaignDraft {
  const eventCode = event.event_code?.trim() || null;
  return {
    ...draft,
    eventId: event.id,
    campaignSetup: {
      ...draft.campaignSetup,
      eventCode: eventCode ?? draft.campaignSetup.eventCode,
    },
  };
}

export async function listTikTokImportEvents(
  supabase: TypedSupabaseClient,
  args: { userId: string; clientId: string },
): Promise<TikTokImportEventOption[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, event_code")
    .eq("user_id", args.userId)
    .eq("client_id", args.clientId)
    .order("event_date", { ascending: true, nullsFirst: false });
  if (error) return [];
  return ((data ?? []) as TikTokImportEventOption[]).map((row) => ({
    id: row.id,
    name: row.name,
    event_code: row.event_code ?? null,
    event_date: row.event_date ?? null,
  }));
}

export async function loadTikTokImportEvent(
  supabase: TypedSupabaseClient,
  args: { eventId: string; userId: string },
): Promise<TikTokImportEventRow | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, event_code, client_id")
    .eq("id", args.eventId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as TikTokImportEventRow;
  return {
    id: row.id,
    name: row.name,
    event_code: row.event_code ?? null,
    event_date: row.event_date ?? null,
    client_id: row.client_id,
  };
}
