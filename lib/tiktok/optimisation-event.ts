/**
 * Explicit deny-list only. Official sources do NOT publish a per-objective
 * supported-event set:
 *
 * 1. `AdgroupCreateBody.optimization_event` is unconstrained `str` (no enum):
 *    https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdgroupCreateBody.md
 * 2. Conversion-events docs still list `ON_WEB_REGISTER` = Complete Registration
 *    as a valid web event (NOT marked Deprecated — only `BUTTON` and
 *    `ON_WEB_ORDER` are). No per-objective supported set:
 *    https://business-api.tiktok.com/portal/docs/conversion-events/v1.3
 *
 * Ads Manager then refuses to edit ad groups created with Complete
 * registration / Contact under website conversions. We block those pairings
 * only. Do not treat this as an allow-list. Do not auto-substitute an event.
 */

import type { TikTokObjective } from "../types/tiktok-draft.ts";

const DENIED_CONVERSIONS_EVENT_CODES = new Set([
  "ON_WEB_REGISTER",
  "COMPLETE_REGISTRATION",
  "CONTACT",
]);

const DENIED_CONVERSIONS_EVENT_NAMES = new Set([
  "complete registration",
  "contact",
]);

export function isUnsupportedTikTokOptimisationEvent(
  objective: TikTokObjective | string | null | undefined,
  eventCode: string | null | undefined,
  eventDisplayName?: string | null,
): boolean {
  if (objective !== "CONVERSIONS") return false;
  const code = eventCode?.trim() ?? "";
  if (code && DENIED_CONVERSIONS_EVENT_CODES.has(code.toUpperCase())) {
    return true;
  }
  const display = (eventDisplayName ?? eventCode ?? "").trim().toLowerCase();
  return display.length > 0 && DENIED_CONVERSIONS_EVENT_NAMES.has(display);
}

export function tikTokUnsupportedOptimisationEventMessage(
  eventCode: string,
): string {
  return `"${eventCode}" is no longer supported for the Conversions objective. Ads Manager will not let you edit the resulting ad group. Choose a different optimisation event.`;
}

export function formatTikTokOptimisationEventLabel(
  event: { optimization_event: string; name: string },
  objective: TikTokObjective | string | null | undefined,
): string {
  const base =
    event.name === event.optimization_event
      ? event.optimization_event
      : `${event.name} · ${event.optimization_event}`;
  if (
    isUnsupportedTikTokOptimisationEvent(
      objective,
      event.optimization_event,
      event.name,
    )
  ) {
    return `${base} (no longer supported for Conversions)`;
  }
  return base;
}
