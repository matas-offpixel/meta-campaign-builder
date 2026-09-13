/**
 * Event identity for a Meta campaign draft.
 *
 * `draft_json.settings.eventId` is the source of truth. `campaign_drafts.event_id`
 * is the query index and must follow the JSON on every save. A duplicate
 * does not inherit the source event — the caller supplies one.
 */

import { parseBracketedEventCode } from "./insights/meta-event-code-match.ts";
import { formatPlanEventDate, type PlanEventOption } from "./plan/event-picker.ts";
import type { CampaignDraft, CampaignSettings } from "./types.ts";

export function toPlanEventOption(row: {
  id: string;
  name: string;
  client_id?: string | null;
  client_name?: string | null;
  venue_name?: string | null;
  event_date?: string | null;
  event_code?: string | null;
}): PlanEventOption {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    clientName: row.client_name,
    venueName: row.venue_name,
    eventDate: row.event_date,
    eventCode: row.event_code,
  };
}

export interface CampaignEventIdentity {
  id: string;
  event_code?: string | null;
  client_id?: string | null;
  name?: string | null;
  venue_city?: string | null;
  venue_name?: string | null;
  event_date?: string | null;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/[\u2013\u2014\u2212]/g, "-");
}

/**
 * JSON wins when it is set. Empty string (migrateDraft default) is missing.
 * Column is the fallback for drafts that predate the picker.
 */
export function resolveDraftEventId(
  jsonEventId: string | null | undefined,
  columnEventId: string | null | undefined,
): string | null {
  const json = jsonEventId?.trim() || "";
  if (json) return json;
  const column = columnEventId?.trim() || "";
  return column || null;
}

export function eventCarriersDisagree(
  jsonEventId: string | null | undefined,
  columnEventId: string | null | undefined,
): boolean {
  const json = jsonEventId?.trim() || "";
  const column = columnEventId?.trim() || "";
  return json !== "" && column !== "" && json !== column;
}

export function replaceEventCodePrefix(name: string, nextCode: string): string {
  const code = nextCode.trim();
  if (!code) return name;
  if (/\[[^\]]+\]/.test(name)) {
    return name.replace(/\[[^\]]+\]/, `[${code}]`);
  }
  return name;
}

export function applyEventToCampaignSettings(
  settings: CampaignSettings,
  event: CampaignEventIdentity,
): CampaignSettings {
  const nextCode = (event.event_code ?? "").trim();
  return {
    ...settings,
    eventId: event.id,
    clientId: event.client_id ?? settings.clientId,
    campaignCode: nextCode,
    campaignName: replaceEventCodePrefix(settings.campaignName, nextCode),
  };
}

/**
 * Appends `(Copy)` then re-derives code and the `[CODE]` prefix from the
 * chosen event. The rest of a hand-edited name is left alone.
 */
export function duplicateCampaignSettings(
  settings: CampaignSettings,
  event: CampaignEventIdentity,
): CampaignSettings {
  if (!event.id.trim()) {
    throw new Error("eventId is required");
  }
  const named: CampaignSettings = {
    ...settings,
    campaignName: settings.campaignName
      ? `${settings.campaignName} (Copy)`
      : "Untitled (Copy)",
  };
  return applyEventToCampaignSettings(named, event);
}

export function buildDuplicatedCampaign(
  original: CampaignDraft,
  event: CampaignEventIdentity,
  now: string,
  id: string,
): CampaignDraft {
  return {
    ...original,
    id,
    settings: duplicateCampaignSettings(original.settings, event),
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

export function formatWiredEventLabel(event: {
  event_code?: string | null;
  name?: string | null;
  venue_city?: string | null;
  event_date?: string | null;
}): string {
  const code = (event.event_code ?? "").trim();
  const name = (event.name ?? "").trim();
  const city = (event.venue_city ?? "").trim();
  const dated = formatPlanEventDate(event.event_date);
  const date = dated ? dated.replace(/\s+\d{4}$/, "") : null;
  const detail = [name, city, date].filter(Boolean).join(", ");
  if (code && detail) return `${code} (${detail})`;
  if (code) return code;
  return detail || "an unnamed event";
}

export function codesDisagree(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = norm(left);
  const b = norm(right);
  if (!a || !b) return false;
  return a !== b;
}

/**
 * campaignCode or the `[CODE]` prefix vs the wired event's event_code.
 * Null when they agree, when there is no event code, or when there is
 * no campaign code and no prefix to compare.
 */
export function describeCodeEventMismatch(input: {
  campaignCode: string | null | undefined;
  campaignName: string | null | undefined;
  event: {
    event_code?: string | null;
    name?: string | null;
    venue_city?: string | null;
    event_date?: string | null;
  } | null;
}): string | null {
  if (!input.event) return null;
  const eventCode = (input.event.event_code ?? "").trim();
  if (!eventCode) return null;
  const campaignCode = (input.campaignCode ?? "").trim();
  const prefix = input.campaignName ? parseBracketedEventCode(input.campaignName) : null;
  const codeDisagrees = campaignCode !== "" && codesDisagree(campaignCode, eventCode);
  const prefixDisagrees = prefix != null && codesDisagree(prefix, eventCode);
  if (!codeDisagrees && !prefixDisagrees) return null;
  const codeSide = campaignCode || prefix;
  if (!codeSide) return null;
  return `code says ${codeSide}, wired to ${formatWiredEventLabel(input.event)}`;
}

export function describeCarrierMismatch(input: {
  jsonEventId: string | null | undefined;
  columnEventId: string | null | undefined;
  jsonEvent: {
    event_code?: string | null;
    name?: string | null;
    venue_city?: string | null;
    event_date?: string | null;
  } | null;
  columnEvent: {
    event_code?: string | null;
    name?: string | null;
    venue_city?: string | null;
    event_date?: string | null;
  } | null;
}): string | null {
  if (!eventCarriersDisagree(input.jsonEventId, input.columnEventId)) return null;
  const draftSide = input.jsonEvent
    ? formatWiredEventLabel(input.jsonEvent)
    : (input.jsonEventId ?? "").trim();
  const columnSide = input.columnEvent
    ? formatWiredEventLabel(input.columnEvent)
    : (input.columnEventId ?? "").trim();
  return `draft says ${draftSide}, column still ${columnSide}. Using the draft.`;
}
