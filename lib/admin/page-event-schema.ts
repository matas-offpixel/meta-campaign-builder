/**
 * lib/admin/page-event-schema.ts
 *
 * Pure validation + payload building for the landing-page CRUD editor
 * (OP909 Phase 3). No imports beyond the LP youtube parser — node:test
 * friendly; the server actions in lib/actions/update-page-event.ts stay
 * thin authenticated shells.
 *
 * Datetime discipline: the admin form uses <input type="datetime-local">
 * which yields a wall-clock string with NO timezone. Events are London
 * events — wall times are interpreted as Europe/London and converted to
 * UTC ISO for the timestamptz columns (matching how the operator
 * dashboard's existing dates behave). DST is handled via the Intl
 * offset probe, not a hardcoded offset.
 */

import {
  CONFIRMATION_BODY_MAX,
  CONFIRMATION_CTA_LABEL_MAX,
} from "../landing-pages/confirmation.ts";
import { parseYouTubeId } from "../landing-pages/youtube.ts";

/**
 * Shared action-state shape for the Phase 3 server actions. Lives here
 * (not in the "use server" module) because every export of an actions
 * module must be an async server function.
 */
export interface PageEventActionState {
  status: "idle" | "saved" | "error";
  errors: Record<string, string>;
}

// ─── Slug ────────────────────────────────────────────────────────────────────

/** Kebab-case slug from an event name (mirrors lib/db/clients.ts slugify). */
export function slugifyEventName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─── London wall time ↔ ISO ─────────────────────────────────────────────────

const LONDON_OFFSET_PROBE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  timeZoneName: "longOffset",
});

/** Minutes east of UTC for Europe/London at the given instant (0 or 60). */
function londonOffsetMinutes(at: Date): number {
  const part = LONDON_OFFSET_PROBE.formatToParts(at).find(
    (p) => p.type === "timeZoneName",
  );
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part?.value ?? "");
  if (!match) return 0; // "GMT" bare = UTC
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * "2026-07-08T18:00" (datetime-local, London wall clock) → UTC ISO string,
 * or null for empty/invalid input.
 */
export function londonWallTimeToIso(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = WALL_RE.exec(raw.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const asUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  if (Number.isNaN(asUtc)) return null;
  // First pass with the offset at the naive instant, second pass to settle
  // DST boundaries (offset(instant) can differ from offset(naive)).
  let instant = asUtc - londonOffsetMinutes(new Date(asUtc)) * 60_000;
  instant = asUtc - londonOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant).toISOString();
}

/** UTC ISO (timestamptz) → "yyyy-MM-ddTHH:mm" London wall clock for prefill. */
export function isoToLondonWallTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

// ─── Form parsing ────────────────────────────────────────────────────────────

export interface PageEventFormValues {
  // Event basics (events table)
  name: string;
  slug: string;
  presale_at: string | null;
  general_sale_at: string | null;
  event_start_at: string | null;
  // Content (page_events.content jsonb)
  title: string | null;
  subtitle: string | null;
  description: string | null;
  venue: string | null;
  venue_short: string | null;
  youtube_url: string | null;
  brand_instagram_url: string | null;
  brand_tiktok_url: string | null;
  // Confirmation card (content jsonb — OP909 Phase 4)
  confirmation_body: string | null;
  confirmation_cta_label: string | null;
  confirmation_cta_url: string | null;
  // Countdown (page_events columns)
  countdown_enabled: boolean;
  countdown_target_at: string | null;
  countdown_label: string | null;
  // Status (page_events column)
  status: "draft" | "live" | "archived";
}

export type PageEventParseResult =
  | { ok: true; value: PageEventFormValues }
  | { ok: false; errors: Record<string, string> };

function emptyToNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validHttpUrl(raw: string): boolean {
  if (raw.length > 2000) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Parse + validate the full edit form (basics + content + countdown +
 * socials + status). All-or-nothing, per-field errors.
 */
export function parsePageEventForm(
  input: Record<string, unknown>,
): PageEventParseResult {
  const errors: Record<string, string> = {};

  const name = emptyToNull(input.name);
  if (!name) errors.name = "Event name is required.";
  else if (name.length > 200) errors.name = "Keep the name under 200 characters.";

  const slugRaw = emptyToNull(input.slug);
  const slug = slugRaw ?? (name ? slugifyEventName(name) : null);
  if (!slug || !SLUG_RE.test(slug)) {
    errors.slug = "Slug must be lowercase letters, numbers, and hyphens.";
  }

  const presaleAt = emptyToNull(input.presale_at);
  const presaleIso = presaleAt ? londonWallTimeToIso(presaleAt) : null;
  if (presaleAt && !presaleIso) errors.presale_at = "Invalid date/time.";

  const generalAt = emptyToNull(input.general_sale_at);
  const generalIso = generalAt ? londonWallTimeToIso(generalAt) : null;
  if (generalAt && !generalIso) errors.general_sale_at = "Invalid date/time.";

  const startAt = emptyToNull(input.event_start_at);
  const startIso = startAt ? londonWallTimeToIso(startAt) : null;
  if (startAt && !startIso) errors.event_start_at = "Invalid date/time.";

  const title = emptyToNull(input.title);
  if (title && title.length > 200) errors.title = "Keep the title under 200 characters.";

  const subtitle = emptyToNull(input.subtitle);
  if (subtitle && subtitle.length > 300)
    errors.subtitle = "Keep the subtitle under 300 characters.";

  const description = emptyToNull(input.description);
  if (description && description.length > 5000)
    errors.description = "Keep the description under 5000 characters.";

  const venue = emptyToNull(input.venue);
  const venueShortRaw = emptyToNull(input.venue_short);
  // Default: first comma-segment of venue.
  const venueShort =
    venueShortRaw ?? (venue ? (venue.split(",")[0]?.trim() ?? null) : null);

  const youtubeUrl = emptyToNull(input.youtube_url);
  if (youtubeUrl && parseYouTubeId(youtubeUrl) === null) {
    errors.youtube_url = "Not a recognisable YouTube URL.";
  }

  const igUrl = emptyToNull(input.brand_instagram_url);
  if (igUrl && !validHttpUrl(igUrl))
    errors.brand_instagram_url = "Must be a valid http(s) URL.";

  const ttUrl = emptyToNull(input.brand_tiktok_url);
  if (ttUrl && !validHttpUrl(ttUrl))
    errors.brand_tiktok_url = "Must be a valid http(s) URL.";

  const confirmationBody = emptyToNull(input.confirmation_body);
  if (confirmationBody && confirmationBody.length > CONFIRMATION_BODY_MAX) {
    errors.confirmation_body = `Keep it under ${CONFIRMATION_BODY_MAX} characters.`;
  }

  const confirmationCtaLabel = emptyToNull(input.confirmation_cta_label);
  if (
    confirmationCtaLabel &&
    confirmationCtaLabel.length > CONFIRMATION_CTA_LABEL_MAX
  ) {
    errors.confirmation_cta_label = `Keep it under ${CONFIRMATION_CTA_LABEL_MAX} characters.`;
  }

  const confirmationCtaUrl = emptyToNull(input.confirmation_cta_url);
  if (confirmationCtaUrl && !validHttpUrl(confirmationCtaUrl)) {
    errors.confirmation_cta_url = "Must be a valid http(s) URL.";
  }
  // The button needs both halves — flag whichever is missing.
  if (confirmationCtaLabel && !confirmationCtaUrl && !errors.confirmation_cta_url) {
    errors.confirmation_cta_url = "Add a URL for the button (or clear the label).";
  }
  if (confirmationCtaUrl && !confirmationCtaLabel && !errors.confirmation_cta_label) {
    errors.confirmation_cta_label = "Add button text (or clear the URL).";
  }

  const countdownEnabled =
    input.countdown_enabled === true ||
    input.countdown_enabled === "true" ||
    input.countdown_enabled === "on";

  const countdownRaw = emptyToNull(input.countdown_target_at);
  const countdownIso = countdownRaw ? londonWallTimeToIso(countdownRaw) : null;
  if (countdownEnabled) {
    if (countdownRaw && !countdownIso) {
      errors.countdown_target_at = "Invalid date/time.";
    } else if (!countdownRaw) {
      errors.countdown_target_at = "Set a countdown target (or disable it).";
    }
  }

  const countdownLabel = emptyToNull(input.countdown_label);
  if (countdownLabel && countdownLabel.length > 60) {
    errors.countdown_label = "Keep the label under 60 characters.";
  }

  const status = input.status;
  if (status !== "draft" && status !== "live" && status !== "archived") {
    errors.status = "Choose draft, live, or archived.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name: name as string,
      slug: slug as string,
      presale_at: presaleIso,
      general_sale_at: generalIso,
      event_start_at: startIso,
      title,
      subtitle,
      description,
      venue,
      venue_short: venueShort,
      youtube_url: youtubeUrl,
      brand_instagram_url: igUrl,
      brand_tiktok_url: ttUrl,
      confirmation_body: confirmationBody,
      confirmation_cta_label: confirmationCtaLabel,
      confirmation_cta_url: confirmationCtaUrl,
      countdown_enabled: countdownEnabled,
      countdown_target_at: countdownEnabled ? countdownIso : null,
      countdown_label: countdownLabel,
      status: status as "draft" | "live" | "archived",
    },
  };
}

// ─── Payload builders ────────────────────────────────────────────────────────

/** events-table UPDATE payload from parsed values. */
export function buildEventUpdate(
  values: PageEventFormValues,
): Record<string, unknown> {
  return {
    name: values.name,
    slug: values.slug,
    presale_at: values.presale_at,
    general_sale_at: values.general_sale_at,
    event_start_at: values.event_start_at,
  };
}

/**
 * page_events UPDATE payload. `content` merges over the CURRENT jsonb so
 * keys this form doesn't own (template_key, operator-authored extras)
 * survive verbatim. Cleared fields DELETE their key (renderer treats
 * missing as unset). confirmation_* became form-owned in Phase 4.
 */
export function buildPageEventUpdate(
  currentContent: Record<string, unknown> | null | undefined,
  values: PageEventFormValues,
): Record<string, unknown> {
  const content: Record<string, unknown> = { ...(currentContent ?? {}) };

  const setOrDelete = (key: string, value: string | null) => {
    if (value === null) delete content[key];
    else content[key] = value;
  };
  setOrDelete("title", values.title);
  setOrDelete("subtitle", values.subtitle);
  setOrDelete("description", values.description);
  setOrDelete("venue", values.venue);
  setOrDelete("venue_short", values.venue_short);
  setOrDelete("brand_instagram_url", values.brand_instagram_url);
  setOrDelete("brand_tiktok_url", values.brand_tiktok_url);
  setOrDelete("confirmation_body", values.confirmation_body);
  setOrDelete("confirmation_cta_label", values.confirmation_cta_label);
  setOrDelete("confirmation_cta_url", values.confirmation_cta_url);

  return {
    content,
    youtube_url: values.youtube_url,
    countdown_target_at: values.countdown_enabled
      ? values.countdown_target_at
      : null,
    countdown_label: values.countdown_label,
    status: values.status,
  };
}

// ─── Asset uploads ───────────────────────────────────────────────────────────

export type AssetKind = "artwork" | "hero" | "bottom";

export const ASSET_KINDS: readonly AssetKind[] = [
  "artwork",
  "hero",
  "bottom",
];

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_ASSET_BYTES = 10 * 1024 * 1024; // bucket file_size_limit

export type AssetPathResult =
  | { ok: true; path: string; ext: string }
  | { ok: false; error: string };

/**
 * Storage path for an LP asset upload. The {clientId}/{pageEventId}/
 * prefix IS the isolation mechanism (bucket writes are service-role only;
 * this builder is the single place paths come from). Filenames are fully
 * server-generated — nothing user-controlled reaches the key.
 */
export function buildAssetPath(
  clientId: string,
  pageEventId: string,
  kind: AssetKind,
  mimeType: string,
  now: Date = new Date(),
): AssetPathResult {
  if (!ASSET_KINDS.includes(kind)) {
    return { ok: false, error: `Unknown asset kind "${kind}".` };
  }
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) {
    return { ok: false, error: "Only JPEG, PNG, or WebP images are allowed." };
  }
  const stamp = now.getTime();
  return {
    ok: true,
    path: `${clientId}/${pageEventId}/${kind}-${stamp}.${ext}`,
    ext,
  };
}

/** Parsed hero_images / bottom_images jsonb → clean string array. */
export function parseImageList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

/** Move `url` one position up/down in the list (no-op when impossible). */
export function moveImage(
  list: readonly string[],
  url: string,
  direction: "up" | "down",
): string[] {
  const index = list.indexOf(url);
  if (index === -1) return [...list];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
