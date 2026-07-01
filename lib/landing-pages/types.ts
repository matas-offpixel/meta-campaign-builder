/**
 * lib/landing-pages/types.ts
 *
 * Row types + the joined-tuple LandingPageContext for the internal
 * client-branded landing pages (migration 132, PR 1 of the landing-page
 * arc). Hand-declared rather than pulled from database.types.ts because the
 * generated types are regenerated from prod and the migration lands there
 * post-merge — regenerate + swap in a later PR if desired.
 *
 * Architecture reference: docs/LANDING_PAGE_ARCHITECTURE.md
 */

/** Rollback lever — which system serves the event's landing page. */
export type LandingPageProvider = "internal" | "evntree";

export const LANDING_PAGE_PROVIDERS: readonly LandingPageProvider[] = [
  "internal",
  "evntree",
] as const;

export type PageEventStatus = "draft" | "live" | "archived";

/** `client_landing_pages` row — per-CLIENT landing-page config. */
export interface ClientLandingPageRow {
  id: string;
  client_id: string;
  /** Theme schema TBD in PR 2. Renderers treat missing keys as globals. */
  theme: Record<string, unknown>;
  /**
   * The CLIENT's own Meta Pixel ID — never Off/Pixel's, never another
   * client's. Cross-contamination between clients is a privacy bug.
   * Distinct from `clients.meta_pixel_id` (the pixel Off/Pixel runs ad
   * campaigns against); never fall back from one to the other.
   */
  meta_pixel_id: string | null;
  /**
   * pgcrypto blob (extensions.pgp_sym_encrypt). Accessor RPCs are PR 4 —
   * nothing in the app reads this yet, and it must NEVER be selected into
   * a public-route context.
   */
  meta_capi_token_encrypted: unknown | null;
  default_provider: LandingPageProvider;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** `page_events` row — per-EVENT landing page (provider toggle lives here). */
export interface PageEventRow {
  id: string;
  event_id: string;
  provider: LandingPageProvider;
  /** Required when provider='evntree' (DB CHECK page_events_evntree_url_required). */
  evntree_url: string | null;
  theme_overrides: Record<string, unknown>;
  /**
   * Free-form page content. Carries `template_key` (which page_templates
   * row renders this page) until PR 2 promotes it to a real FK column.
   */
  content: Record<string, unknown>;
  status: PageEventStatus;
  created_at: string;
  updated_at: string;
}

/** `page_templates` row — workspace-global template registry. */
export interface PageTemplateRow {
  id: string;
  key: string;
  name: string;
  block_types_supported: string[];
  default_config: Record<string, unknown>;
  version: number;
}

/** Template key assumed when page_events.content.template_key is absent. */
export const DEFAULT_TEMPLATE_KEY = "mvp_v1";

/**
 * The joined tuple the public /l/[clientSlug]/[eventSlug] route resolves.
 *
 * Deliberately NARROW on client/event: only the public-safe display fields
 * are carried. In particular `meta_capi_token_encrypted` is never selected
 * into this shape, and `landingPage.meta_pixel_id` is the ONLY pixel id in
 * scope — resolved strictly through the clientSlug → client_id chain so no
 * other client's row can ever be joined in (see the isolation test).
 */
export interface LandingPageContext {
  client: {
    id: string;
    name: string;
    slug: string;
  };
  event: {
    id: string;
    name: string;
    slug: string;
    event_date: string | null;
    venue_name: string | null;
    venue_city: string | null;
    ticket_url: string | null;
  };
  pageEvent: PageEventRow;
  /**
   * Null when the client has no client_landing_pages row yet — the page can
   * still render/redirect; theme + pixel simply have nothing to contribute.
   */
  landingPage: Pick<
    ClientLandingPageRow,
    "id" | "client_id" | "theme" | "meta_pixel_id" | "default_provider"
  > | null;
  /** Null when content.template_key names a template that does not exist. */
  template: PageTemplateRow | null;
}

/**
 * What the public route should do with a resolved context. Kept as a typed
 * outcome (rather than branching inline in the page) so the loud-fail branch
 * is unit-testable without an HTTP harness.
 */
export type LandingPageOutcome =
  | { kind: "render"; context: LandingPageContext }
  | { kind: "redirect"; url: string }
  /**
   * provider='evntree' but evntree_url is null. The DB CHECK
   * (page_events_evntree_url_required) makes this unreachable through
   * normal writes — if it ever appears (manual SQL, future migration bug),
   * the route throws instead of silently redirecting to a blank target.
   */
  | { kind: "misconfigured"; reason: string };
