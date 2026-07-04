import {
  DEFAULT_TEMPLATE_KEY,
  type LandingPageContext,
  type PageEventRow,
  type PageTemplateRow,
} from "./types.ts";

/**
 * lib/landing-pages/context.ts
 *
 * The slug → joined-tuple resolution core for the public landing-page
 * route. Pure DI (no supabase import, no "@/" aliases) so node:test can run
 * the REAL chain against an in-memory fake — including the multi-tenant
 * isolation test. Production entrypoint: getLandingPageContext in
 * lib/db/landing-pages.ts, which injects the service-role client.
 *
 * Authorisation model — there is no fan session on /l, so RLS cannot be the
 * authorisation source. Instead, authorisation *is* the resolution chain:
 *
 *   clientSlug → clients row
 *             → events row     (slug AND client_id from step 1 must match)
 *             → page_events    (event_id from step 2)
 *             → client_landing_pages (client_id from step 1 ONLY)
 *
 * Every step keys off the previous step's id, so a valid eventSlug under
 * the wrong clientSlug resolves to nothing (404) and no other client's
 * pixel/theme can be joined in. `meta_capi_token_encrypted` is NEVER
 * selected — it has no business on a public route in any PR.
 */

/**
 * Minimal structural slice of the Supabase query builder used here. Lets
 * tests inject an in-memory fake without the SupabaseClient generics.
 */
export interface LandingPagesDb {
  from(table: string): {
    select(columns: string): SelectFilterBuilder;
  };
}

export interface SelectFilterBuilder
  extends PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }> {
  eq(column: string, value: unknown): SelectFilterBuilder;
}

async function selectRows(
  db: LandingPagesDb,
  table: string,
  columns: string,
  filters: ReadonlyArray<readonly [string, unknown]>,
): Promise<unknown[]> {
  let builder = db.from(table).select(columns);
  for (const [column, value] of filters) {
    builder = builder.eq(column, value);
  }
  const { data, error } = await builder;
  if (error) {
    throw new Error(`[landing-pages] ${table} lookup failed: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Resolve the full joined tuple for a public landing-page URL, or null when
 * any link of the chain is missing (unknown client slug, unknown event
 * slug, event not under that client, or no page_events row) — callers turn
 * null into a 404.
 *
 * Throws on ambiguity (two clients sharing a slug across users — possible
 * because clients.slug is only unique per (user_id, slug)) rather than
 * guessing: a public URL that could resolve to two tenants must fail loudly.
 */
export async function resolveLandingPageContext(
  db: LandingPagesDb,
  clientSlug: string,
  eventSlug: string,
): Promise<LandingPageContext | null> {
  // 1. Client by slug. Public-safe fields only.
  const clients = (await selectRows(db, "clients", "id, name, slug", [
    ["slug", clientSlug],
  ])) as Array<{ id: string; name: string; slug: string }>;
  if (clients.length === 0) return null;
  if (clients.length > 1) {
    throw new Error(
      `[landing-pages] client slug "${clientSlug}" is ambiguous ` +
        `(${clients.length} rows — clients.slug is only unique per user). ` +
        `Refusing to guess a tenant on a public route.`,
    );
  }
  const clientRow = clients[0];

  // 2. Event by slug UNDER THIS CLIENT. The client_id filter is the
  //    ownership chain — the same eventSlug under another client 404s.
  const events = (await selectRows(
    db,
    "events",
    "id, name, slug, client_id, event_date, venue_name, venue_city, ticket_url, capacity, " +
      "presale_at, general_sale_at, event_start_at",
    [
      ["slug", eventSlug],
      ["client_id", clientRow.id],
    ],
  )) as Array<{
    id: string;
    name: string;
    slug: string;
    client_id: string;
    event_date: string | null;
    venue_name: string | null;
    venue_city: string | null;
    ticket_url: string | null;
    capacity: number | null;
    presale_at: string | null;
    general_sale_at: string | null;
    event_start_at: string | null;
  }>;
  if (events.length === 0) return null;
  if (events.length > 1) {
    throw new Error(
      `[landing-pages] event slug "${eventSlug}" is ambiguous under client ` +
        `"${clientSlug}" (${events.length} rows).`,
    );
  }
  const eventRow = events[0];

  // 3. page_events by event_id. No row → the event has no landing page → 404.
  const pageEvents = (await selectRows(
    db,
    "page_events",
    "id, event_id, provider, evntree_url, theme_overrides, content, status, created_at, updated_at, " +
      "artwork_palette, hero_images, countdown_target_at, countdown_label, youtube_url, bottom_images",
    [["event_id", eventRow.id]],
  )) as PageEventRow[];
  if (pageEvents.length === 0) return null;
  const pageEvent = pageEvents[0];

  // 4. client_landing_pages — keyed STRICTLY off the client id resolved in
  //    step 1. meta_capi_token_encrypted is deliberately not selected.
  const landingPages = (await selectRows(
    db,
    "client_landing_pages",
    "id, client_id, theme, meta_pixel_id, default_provider, " +
      "privacy_policy_url, logo_style, box_logo_text, show_off_pixel_attribution",
    [["client_id", clientRow.id]],
  )) as Array<{
    id: string;
    client_id: string;
    theme: Record<string, unknown>;
    meta_pixel_id: string | null;
    default_provider: "internal" | "evntree";
    privacy_policy_url: string | null;
    logo_style: "box_logo" | "wordmark" | null;
    box_logo_text: string | null;
    show_off_pixel_attribution: boolean | null;
  }>;
  const landingPageRaw = landingPages[0] ?? null;
  const landingPage = landingPageRaw
    ? {
        ...landingPageRaw,
        // NULL-safe defaults matching the migration-136 column defaults —
        // fakes/older rows without the columns still resolve cleanly.
        logo_style: landingPageRaw.logo_style ?? ("box_logo" as const),
        show_off_pixel_attribution:
          landingPageRaw.show_off_pixel_attribution ?? true,
      }
    : null;

  // 5. Template row for content.template_key (default mvp_v1). Missing
  //    template → null; the placeholder renders the key it looked for.
  const templateKey =
    typeof pageEvent.content?.template_key === "string"
      ? pageEvent.content.template_key
      : DEFAULT_TEMPLATE_KEY;
  const templates = (await selectRows(
    db,
    "page_templates",
    "id, key, name, block_types_supported, default_config, version",
    [["key", templateKey]],
  )) as PageTemplateRow[];
  const template = templates[0] ?? null;

  return {
    client: {
      id: clientRow.id,
      name: clientRow.name,
      slug: clientRow.slug,
    },
    event: {
      id: eventRow.id,
      name: eventRow.name,
      slug: eventRow.slug,
      event_date: eventRow.event_date,
      venue_name: eventRow.venue_name,
      venue_city: eventRow.venue_city,
      ticket_url: eventRow.ticket_url,
      capacity: eventRow.capacity,
      presale_at: eventRow.presale_at,
      general_sale_at: eventRow.general_sale_at,
      event_start_at: eventRow.event_start_at,
    },
    pageEvent,
    landingPage,
    template,
  };
}
