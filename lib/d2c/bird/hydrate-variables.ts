/**
 * lib/d2c/bird/hydrate-variables.ts
 *
 * Layer 7 of the 2026-07-01 direct-fire incident. The dispatcher was sending
 * Bird WhatsApp template messages with `variables: {}` — the scheduled-send
 * row's stored variables were empty, so every one of the template's REQUIRED
 * parameters reached Bird unbound and the send errored.
 *
 * `hydrateSendVariables` resolves the 6 variables the Jackies autoresp /
 * community templates require from the event + event-copy + client rows we
 * already hold at dispatch time, and LOUD-FAILS (throws
 * MissingTemplateVariablesError) if any required variable resolves to
 * null/empty — so a bad send surfaces as a `failed` status BEFORE any HTTP
 * call, never as a malformed Bird request.
 *
 * Pure + dependency-free (no Supabase, no fetch) so it is fully unit-testable
 * and safe to import from anywhere. The caller fetches the rows; this maps.
 *
 * Wiring (pending the layer 6/9 runtime-send capture): call this in the Bird
 * direct-fire branch of the orchestration path, immediately before the
 * provider send. See docs/D2C_LIVE_FIRE_RUNBOOK.md § "Where this plugs in".
 */

/** The template variables every Jackies WhatsApp runtime send must bind. */
export const REQUIRED_BIRD_TEMPLATE_VARIABLES = [
  "event_name",
  "event_date",
  "event_artwork_url",
  "presale_day",
  "presale_time",
  "wa_community_invite",
] as const;

export type RequiredBirdTemplateVariable =
  (typeof REQUIRED_BIRD_TEMPLATE_VARIABLES)[number];

export class MissingTemplateVariablesError extends Error {
  readonly missing: RequiredBirdTemplateVariable[];
  constructor(missing: RequiredBirdTemplateVariable[]) {
    super(
      `Refusing Bird template send: ${missing.length} required variable(s) unresolved: ${missing.join(", ")}. ` +
        "Set d2c_event_copy.whatsapp_community_url / artwork_url and event date fields before approving.",
    );
    this.name = "MissingTemplateVariablesError";
    this.missing = missing;
  }
}

/** Event fields needed to hydrate the template. */
export interface HydrateEvent {
  name: string | null;
  event_date: string | null;
  event_start_at: string | null;
  event_timezone: string | null;
  presale_at: string | null;
}

/** d2c_event_copy fields needed to hydrate the template. */
export interface HydrateEventCopy {
  artwork_url: string | null;
  whatsapp_community_url: string | null;
}

/** Optional client context — currently only supplies a preferred locale. */
export interface HydrateClient {
  /** BCP-47 locale used to format the date/time strings (e.g. 'es-ES'). */
  locale?: string | null;
}

/** The scheduled-send row — its `variables` act as explicit overrides. */
export interface HydrateSendRow {
  variables?: Record<string, unknown> | null;
}

export interface HydrateResult {
  variables: Record<RequiredBirdTemplateVariable, string>;
}

/**
 * Extracts the invite code from a WhatsApp community/group URL, stripping the
 * protocol, domain, and any query string / fragment.
 *
 *   https://chat.whatsapp.com/ABC123def?foo=1  → "ABC123def"
 *   chat.whatsapp.com/ABC123def/               → "ABC123def"
 *   ABC123def                                  → "ABC123def"  (already a code)
 *
 * Returns "" when nothing usable is present.
 */
export function extractWhatsappInviteCode(
  url: string | null | undefined,
): string {
  if (!url || typeof url !== "string") return "";
  let s = url.trim();
  if (!s) return "";
  // Drop fragment + query.
  s = s.split("#")[0].split("?")[0];
  // Drop protocol.
  s = s.replace(/^[a-z]+:\/\//i, "");
  // Drop trailing slashes.
  s = s.replace(/\/+$/, "");
  // If a domain/path remains, keep the last non-empty path segment.
  const segments = s.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  // When a domain is present (contains a dot and there are >=2 segments), the
  // code is the last segment. When the input was already a bare code (single
  // segment, no dot), return it as-is.
  const last = segments[segments.length - 1];
  // Guard: if the only segment still looks like a domain, there's no code.
  if (segments.length === 1 && last.includes(".")) return "";
  return last;
}

function firstNonEmptyIso(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return null;
}

function formatDatePart(
  iso: string | null,
  timeZone: string | null,
  locale: string | null,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      timeZone: timeZone && timeZone.trim() ? timeZone : undefined,
      day: "numeric",
      month: "long",
      weekday: "long",
    }).format(d);
  } catch {
    return "";
  }
}

function formatTimePart(
  iso: string | null,
  timeZone: string | null,
  locale: string | null,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      timeZone: timeZone && timeZone.trim() ? timeZone : undefined,
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

/**
 * Resolves the 6 required Bird template variables. Explicit values on
 * `sendRow.variables` win over derived values (manual operator overrides).
 *
 * @throws MissingTemplateVariablesError if any required variable is empty.
 */
export function hydrateSendVariables(
  sendRow: HydrateSendRow,
  eventCopy: HydrateEventCopy,
  event: HydrateEvent,
  client?: HydrateClient,
): HydrateResult {
  const locale = client?.locale ?? null;
  const tz = event.event_timezone;
  const eventIso = firstNonEmptyIso(event.event_start_at, event.event_date);

  const derived: Record<RequiredBirdTemplateVariable, string> = {
    event_name: (event.name ?? "").trim(),
    event_date: formatDatePart(eventIso, tz, locale),
    event_artwork_url: (eventCopy.artwork_url ?? "").trim(),
    presale_day: formatDatePart(event.presale_at, tz, locale),
    presale_time: formatTimePart(event.presale_at, tz, locale),
    wa_community_invite: extractWhatsappInviteCode(
      eventCopy.whatsapp_community_url,
    ),
  };

  // Overlay explicit overrides from the send row.
  const overrides = sendRow.variables ?? {};
  const variables = { ...derived };
  for (const key of REQUIRED_BIRD_TEMPLATE_VARIABLES) {
    const ov = overrides[key];
    if (ov !== undefined && ov !== null && String(ov).trim() !== "") {
      variables[key] = String(ov).trim();
    }
  }

  const missing = REQUIRED_BIRD_TEMPLATE_VARIABLES.filter(
    (k) => !variables[k] || variables[k].trim() === "",
  );
  if (missing.length > 0) {
    throw new MissingTemplateVariablesError(missing);
  }

  return { variables };
}
