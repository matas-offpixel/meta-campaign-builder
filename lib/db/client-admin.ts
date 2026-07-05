import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * lib/db/client-admin.ts
 *
 * Read helpers for the client admin dashboard (OP909). All queries run on
 * the SESSION-bound Supabase client — the client-member read policies
 * (migration 137) scope every row to the caller's own client, so there is
 * no service-role in this module at all. Callers must have already run
 * requireClientContext() (the client_id passed in comes from it, never
 * from user input).
 */

export interface ClientPageSummary {
  pageEventId: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
  status: string;
  presaleAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  signupCount: number;
  /** content.artwork_url when present — powers the Pages-list thumbnail. */
  artworkUrl: string | null;
}

interface EmbeddedPageRow {
  id: string;
  status: string;
  updated_at: string | null;
  created_at: string | null;
  content: Record<string, unknown> | null;
}

interface EventRowWithPage {
  id: string;
  name: string;
  slug: string;
  presale_at: string | null;
  page_events: EmbeddedPageRow | Array<EmbeddedPageRow> | null;
}

/** page_events embeds as object or 1-element array — normalise both. */
function embeddedPage(row: EventRowWithPage) {
  const pe = row.page_events;
  if (!pe) return null;
  return Array.isArray(pe) ? (pe[0] ?? null) : pe;
}

/**
 * Every landing page under this client (events that HAVE a page_events
 * row), newest presale first, with live signup counts.
 */
export async function listClientPages(
  clientId: string,
): Promise<ClientPageSummary[]> {
  const supabase = await createClient();

  const [{ data: events, error: eventsError }, signupCounts] =
    await Promise.all([
      supabase
        .from("events")
        .select(
          "id, name, slug, presale_at, page_events (id, status, updated_at, created_at, content)",
        )
        .eq("client_id", clientId),
      countSignupsByEvent(clientId),
    ]);
  if (eventsError) {
    throw new Error(`[client-admin] events lookup failed: ${eventsError.message}`);
  }

  const pages: ClientPageSummary[] = [];
  for (const row of (events ?? []) as unknown as EventRowWithPage[]) {
    const page = embeddedPage(row);
    if (!page) continue; // event without a landing page
    const artwork = page.content?.["artwork_url"];
    pages.push({
      pageEventId: page.id,
      eventId: row.id,
      eventName: row.name,
      eventSlug: row.slug,
      status: page.status,
      presaleAt: row.presale_at,
      createdAt: page.created_at,
      updatedAt: page.updated_at,
      signupCount: signupCounts.get(row.id) ?? 0,
      artworkUrl:
        typeof artwork === "string" && artwork.trim().length > 0
          ? artwork.trim()
          : null,
    });
  }
  pages.sort((a, b) => (b.presaleAt ?? "").localeCompare(a.presaleAt ?? ""));
  return pages;
}

/**
 * Per-event signup counts for the client (soft-deleted rows excluded).
 * Selects only event_id — no PII columns cross this boundary.
 */
async function countSignupsByEvent(
  clientId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_signups")
    .select("event_id")
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(
      `[client-admin] signup count lookup failed: ${error.message}`,
    );
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ event_id: string }>) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

import { resolveAccent } from "@/lib/landing-pages/theme";

export interface ClientBranding {
  /** Sanitised brand accent — client theme primary → #E5322D. */
  accent: string;
  /** Box-logo text; falls back to the client name. */
  boxLogoText: string;
  logoStyle: "box_logo" | "wordmark";
}

/**
 * Client-level branding for the admin shell + Pages thumbnails. Uses the
 * SAME resolveAccent() precedence as the fan-facing LP (client theme
 * primary_color → default red) — there is no per-page artwork palette at
 * the shell level, so palette is null here.
 */
export async function getClientBranding(
  clientId: string,
  clientName: string,
): Promise<ClientBranding> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_landing_pages")
    .select("theme, logo_style, box_logo_text")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`[client-admin] branding lookup failed: ${error.message}`);
  }
  const row = (data ?? null) as {
    theme: Record<string, unknown> | null;
    logo_style: "box_logo" | "wordmark" | null;
    box_logo_text: string | null;
  } | null;
  return {
    accent: resolveAccent(null, row?.theme ?? null),
    boxLogoText: row?.box_logo_text?.trim() || clientName,
    logoStyle: row?.logo_style ?? "box_logo",
  };
}

/** Total (non-deleted) signups across the whole client. */
export async function countClientSignups(clientId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("event_signups")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(
      `[client-admin] signup total lookup failed: ${error.message}`,
    );
  }
  return count ?? 0;
}

// ─── Phase 6: insights reads ─────────────────────────────────────────────────

import type { InsightSignupRow } from "@/lib/admin/insights";

/**
 * Lightweight non-PII rows for the analytics aggregations — canonical
 * (non-repeat), non-deleted signups only, optionally scoped to one
 * event. Session client; no encrypted column ever crosses this
 * boundary.
 */
export async function listInsightRows(
  clientId: string,
  eventId: string | null,
): Promise<InsightSignupRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("event_signups")
    .select("created_at, geo_country, ig_handle, tt_handle, consent_wa_opt_in_at")
    .eq("client_id", clientId)
    .is("deduplicated_signup_id", null)
    .is("deleted_at", null);
  if (eventId) query = query.eq("event_id", eventId);
  const { data, error } = await query;
  if (error) {
    throw new Error(`[client-admin] insight rows lookup failed: ${error.message}`);
  }
  return ((data ?? []) as Array<{
    created_at: string;
    geo_country: string | null;
    ig_handle: string | null;
    tt_handle: string | null;
    consent_wa_opt_in_at: string | null;
  }>).map((row) => ({
    createdAt: row.created_at,
    country: row.geo_country,
    igHandle: row.ig_handle,
    ttHandle: row.tt_handle,
    waOptInAt: row.consent_wa_opt_in_at,
  }));
}

/** Pixel config state for the health panel — no secrets cross here. */
export interface PixelHealth {
  pixelId: string | null;
  capiTokenConfigured: boolean;
  testEventCode: string | null;
  verifiedAt: string | null;
}

export async function getPixelHealth(
  clientId: string,
): Promise<PixelHealth | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_landing_pages")
    .select(
      "meta_pixel_id, meta_capi_token_encrypted, meta_test_event_code, meta_pixel_id_verified_at",
    )
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`[client-admin] pixel health lookup failed: ${error.message}`);
  }
  if (!data) return null;
  const row = data as unknown as {
    meta_pixel_id: string | null;
    meta_capi_token_encrypted: unknown;
    meta_test_event_code: string | null;
    meta_pixel_id_verified_at: string | null;
  };
  return {
    pixelId: row.meta_pixel_id,
    // Presence only — the blob itself never leaves this function.
    capiTokenConfigured: row.meta_capi_token_encrypted != null,
    testEventCode: row.meta_test_event_code,
    verifiedAt: row.meta_pixel_id_verified_at,
  };
}

// ─── Phase 3: landing page CRUD reads ────────────────────────────────────────

export interface EventOption {
  eventId: string;
  eventName: string;
  eventSlug: string;
  eventStartAt: string | null;
}

/** Client events that do NOT have a page_events row yet (create flow a). */
export async function listEventsWithoutPage(
  clientId: string,
): Promise<EventOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, event_start_at, page_events (id)")
    .eq("client_id", clientId);
  if (error) {
    throw new Error(`[client-admin] events lookup failed: ${error.message}`);
  }
  const options: EventOption[] = [];
  for (const row of (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    slug: string;
    event_start_at: string | null;
    page_events: unknown;
  }>) {
    const pe = row.page_events;
    const hasPage = Array.isArray(pe) ? pe.length > 0 : pe != null;
    if (hasPage) continue;
    options.push({
      eventId: row.id,
      eventName: row.name,
      eventSlug: row.slug,
      eventStartAt: row.event_start_at,
    });
  }
  options.sort((a, b) =>
    (b.eventStartAt ?? "").localeCompare(a.eventStartAt ?? ""),
  );
  return options;
}

export interface PageEventEditView {
  pageEventId: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
  presaleAt: string | null;
  generalSaleAt: string | null;
  eventStartAt: string | null;
  status: string;
  content: Record<string, unknown>;
  heroImages: string[];
  bottomImages: string[];
  countdownTargetAt: string | null;
  countdownLabel: string | null;
  youtubeUrl: string | null;
}

/**
 * Full editor view for one page. Session client — the RLS join through
 * events.client_id means asking for another tenant's page id returns
 * null (→ notFound), identical to a nonexistent id.
 */
export async function getPageEventForEdit(
  clientId: string,
  pageEventId: string,
): Promise<PageEventEditView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("page_events")
    .select(
      "id, event_id, status, content, hero_images, bottom_images, " +
        "countdown_target_at, countdown_label, youtube_url, " +
        "events!inner (id, name, slug, client_id, presale_at, general_sale_at, event_start_at)",
    )
    .eq("id", pageEventId)
    .eq("events.client_id", clientId)
    .maybeSingle();
  if (error) {
    throw new Error(`[client-admin] page edit lookup failed: ${error.message}`);
  }
  if (!data) return null;

  const row = data as unknown as {
    id: string;
    event_id: string;
    status: string;
    content: Record<string, unknown> | null;
    hero_images: unknown;
    bottom_images: unknown;
    countdown_target_at: string | null;
    countdown_label: string | null;
    youtube_url: string | null;
    events:
      | {
          id: string;
          name: string;
          slug: string;
          presale_at: string | null;
          general_sale_at: string | null;
          event_start_at: string | null;
        }
      | Array<{
          id: string;
          name: string;
          slug: string;
          presale_at: string | null;
          general_sale_at: string | null;
          event_start_at: string | null;
        }>;
  };
  const event = Array.isArray(row.events) ? row.events[0] : row.events;
  if (!event) return null;

  const toList = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw.filter((u): u is string => typeof u === "string" && u.length > 0)
      : [];

  return {
    pageEventId: row.id,
    eventId: event.id,
    eventName: event.name,
    eventSlug: event.slug,
    presaleAt: event.presale_at,
    generalSaleAt: event.general_sale_at,
    eventStartAt: event.event_start_at,
    status: row.status,
    content: row.content ?? {},
    heroImages: toList(row.hero_images),
    bottomImages: toList(row.bottom_images),
    countdownTargetAt: row.countdown_target_at,
    countdownLabel: row.countdown_label,
    youtubeUrl: row.youtube_url,
  };
}
