/**
 * lib/d2c/bird/template-variables.ts
 *
 * Live-verified 2026-07-08 on prod (Throwback Algarve): PR #699 fixed the
 * template-detection downgrade (Bug B) — Bird now takes the template path —
 * but 422s with "missing value for variable" for every one of the template's
 * declared variables, because `d2c_scheduled_sends.variables` never carried
 * them: it only holds `locale`, `artwork_url` (not `event_artwork_url`),
 * `artwork_source`, `artwork_gdrive_id`, and the `bird_template_*` identity
 * fields `lib/d2c/bird/provider.ts` reads for Bug B. `provider.ts` spreads
 * `message.variables` key-by-key into Bird's flat `parameters` array with no
 * name mapping, so a template variable is only ever filled if the exact key
 * is present.
 *
 * This resolver derives the template variables fresh from the event +
 * `d2c_event_copy` rows at fire time — the source-of-truth data already
 * exists, it was just never mapped into the right key names.
 *
 * Variable union (enumerated from every registered Bird template — see spec
 * correction note below):
 *   - throwback_autoresp:         event_name, event_date, presale_day,
 *                                 presale_time, event_artwork_url (header),
 *                                 wa_community_invite (button url)
 *   - throwback_presale_reminder: event_name, presale_time,
 *                                 event_artwork_url (header),
 *                                 wa_community_invite (button url)
 *   - throwback_presale_live:     event_name, event_url_suffix (button url),
 *                                 event_artwork_url (header)
 *   (jackies.ts declares the same variable NAMES as throwback.ts — both
 *   brands' templates are covered by this one union.)
 *
 * SPEC CORRECTION: the original ask specified 6 variables (event_name,
 * event_date, presale_day, presale_time, event_artwork_url,
 * wa_community_invite) — the exact set `throwback_autoresp` needs, matching
 * the 422 that prompted this fix. But `throwback_presale_live` ALSO needs
 * `event_url_suffix` (its button URL is `https://ra.co/events/{{event_url_suffix}}`,
 * per throwback.ts / jackies.ts), which the 6-variable set omits — that
 * template would 422 the same way the moment its own test-send/fire path
 * exercised it. Added `event_url_suffix` (last path segment of
 * `event.ticket_url`) to the resolver's output so it covers every
 * registered template's declared variables, not just the one that surfaced
 * the bug report.
 *
 * `wa_community_invite`: the original ask's pseudocode passed
 * `copy.whatsapp_community_url` straight through, but every template's
 * button URL is `https://app.offpixel.co.uk/j/{{wa_community_invite}}` —
 * that variable is the INVITE CODE (the last path segment of a
 * `chat.whatsapp.com/...` URL), not the full URL. Passing the full URL would
 * double up the domain in the rendered button link. Reuses
 * `extractWhatsappInviteCode` from `./hydrate-variables.ts` (already
 * written + tested for this exact purpose) rather than re-deriving it.
 *
 * Note: `./hydrate-variables.ts` already implements an equivalent resolver
 * (`hydrateSendVariables`, same 6-variable set minus `event_url_suffix`) —
 * but it has never been wired into a reachable send path: its only
 * reference is a code comment in `lib/d2c/orchestration/bird-runner.ts`,
 * whose `executeBirdJob` throws `BIRD_RUNTIME_UNVERIFIED` unconditionally
 * before that point is ever reached (a different, still-blocked
 * orchestration flow — not the live `fire.ts` / test-send path this PR
 * wires up). Left `hydrate-variables.ts` untouched (out of scope — it isn't
 * one of the two call sites this PR targets) and flagged the duplication in
 * the PR body for a follow-up consolidation pass; this file also throws no
 * exception on missing values (returns "" — Bird's own 422 is the signal,
 * matching the ask's pseudocode) where `hydrateSendVariables` loud-fails.
 *
 * Pure + dependency-free — safe to import from anywhere, fully unit-testable.
 */

import { extractWhatsappInviteCode } from "./hydrate-variables.ts";

export interface BirdTemplateVarInput {
  event: {
    name: string;
    event_start_at: string | null;
    presale_at: string | null;
    /** RA.co (or other) ticket URL — last path segment feeds `event_url_suffix`. */
    ticket_url: string | null;
  };
  copy: {
    artwork_url: string | null;
    whatsapp_community_url: string | null;
  };
  /** IANA timezone (e.g. "Europe/London") — caller resolves from
   *  `event.event_timezone`, defaulting per the codebase-wide convention
   *  (see `lib/campaign-defaults.ts`, `lib/ticketing/eventbrite/orders.ts`). */
  timezone: string;
}

function ordinalSuffix(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * "Saturday 8th August" — weekday + ordinal day-of-month + month, no year,
 * no comma (matches the approved Bird template copy style, per
 * throwback.ts's `variableExamples`, e.g. "Saturday 6 June" minus the
 * ordinal — Bird's own samples omit it, but Matas's live template renders
 * with it, per the bug report's worked example). Returns "" for a null/
 * invalid iso timestamp.
 */
function formatFullDateWithOrdinal(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const weekday = get("weekday");
    const month = get("month");
    const day = Number(get("day"));
    if (!weekday || !month || !Number.isFinite(day) || day <= 0) return "";
    return `${weekday} ${day}${ordinalSuffix(day)} ${month}`;
  } catch {
    return "";
  }
}

/** "Saturday 8th August" for the event's own start date. */
export function formatEventDate(iso: string | null, timezone: string): string {
  return formatFullDateWithOrdinal(iso, timezone);
}

/** "Wednesday 15th July" for the presale open date. */
export function formatPresaleDay(iso: string | null, timezone: string): string {
  return formatFullDateWithOrdinal(iso, timezone);
}

/** "12:00" — 24-hour, zero-padded, no AM/PM. Returns "" for a null/invalid iso. */
export function formatPresaleTime(iso: string | null, timezone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    if (!hour || !minute) return "";
    return `${hour}:${minute}`;
  } catch {
    return "";
  }
}

/**
 * `https://ra.co/events/2123456` → `"2123456"`; `https://ra.co/2123456` →
 * `"2123456"` too (last non-empty path segment, domain stripped). Returns ""
 * when nothing usable is present. Feeds `throwback_presale_live` /
 * `jackies_presale_live`'s button URL (`https://ra.co/events/{{event_url_suffix}}`).
 */
export function extractEventUrlSuffix(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "";
  let s = url.trim();
  if (!s) return "";
  s = s.split("#")[0].split("?")[0];
  s = s.replace(/^[a-z]+:\/\//i, "");
  s = s.replace(/\/+$/, "");
  const segments = s.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  return segments[segments.length - 1];
}

/**
 * Resolve every Bird WhatsApp template variable declared across the
 * registered throwback/jackies templates, fresh from the event +
 * `d2c_event_copy` rows. Pure — deterministic for the same input, never
 * throws (missing/invalid inputs resolve to "" — Bird's own 422 surfaces a
 * genuinely-missing value, same as this file's ask's own pseudocode).
 */
export function resolveBirdTemplateVariables(
  input: BirdTemplateVarInput,
): Record<string, string> {
  return {
    event_name: input.event.name ?? "",
    event_date: formatEventDate(input.event.event_start_at, input.timezone),
    presale_day: formatPresaleDay(input.event.presale_at, input.timezone),
    presale_time: formatPresaleTime(input.event.presale_at, input.timezone),
    event_artwork_url: input.copy.artwork_url ?? "",
    wa_community_invite: extractWhatsappInviteCode(input.copy.whatsapp_community_url),
    event_url_suffix: extractEventUrlSuffix(input.event.ticket_url),
  };
}
