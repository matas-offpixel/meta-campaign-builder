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

/** client_landing_pages.logo_style (migration 136). */
export type LandingPageLogoStyle = "box_logo" | "wordmark";

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
  // ── PR 6 (migration 136) presentation + consent config ──
  /** Linked from the signup consent line (target _blank). */
  privacy_policy_url: string | null;
  logo_style: LandingPageLogoStyle;
  /** Text inside the accent-colored box logo (logo_style='box_logo'). */
  box_logo_text: string | null;
  /** When true the footer renders the off/pixel attribution block. */
  show_off_pixel_attribution: boolean;
  /** Schema-only in PR 6 — no renderer reads these yet. */
  partner_consent_enabled: boolean;
  partner_name: string | null;
  partner_privacy_policy_url: string | null;
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
  // ── PR 6 (migration 136) per-event presentation ──
  /** Server-extracted ["#RRGGBB", …] (primary first) or null = not yet run. */
  artwork_palette: unknown | null;
  /** Ordered hero-carousel URLs; empty → fall back to content.artwork_url. */
  hero_images: unknown;
  /** Countdown target ISO timestamp. Null (or past) hides the block. */
  countdown_target_at: string | null;
  countdown_label: string | null;
  /** YouTube watch/short/embed URL for the bottom lite-embed. */
  youtube_url: string | null;
  /** Bottom image-grid URLs; empty hides the grid. */
  bottom_images: unknown;
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
    /** PR 6: shown in the details line when present. */
    capacity: number | null;
    /**
     * PR 7: on-sale timestamps from the shared `events` table (read-only
     * for this arc — dashboard-boundaries). Still consumed by the
     * post-signup confirmation copy (view.onSaleAt) — the PR-8 header
     * meta row below reads event_start_at instead (see next field).
     */
    presale_at: string | null;
    general_sale_at: string | null;
    /**
     * PR 8: the header meta row's date source (Europe/London), replacing
     * the PR-7 on-sale timestamp there. Read-only for this arc — shared
     * dashboard table, dashboard-boundaries.
     */
    event_start_at: string | null;
  };
  pageEvent: PageEventRow;
  /**
   * Null when the client has no client_landing_pages row yet — the page can
   * still render/redirect; theme + pixel simply have nothing to contribute.
   */
  landingPage: Pick<
    ClientLandingPageRow,
    | "id"
    | "client_id"
    | "theme"
    | "meta_pixel_id"
    | "default_provider"
    | "privacy_policy_url"
    | "logo_style"
    | "box_logo_text"
    | "show_off_pixel_attribution"
  > | null;
  /** Null when content.template_key names a template that does not exist. */
  template: PageTemplateRow | null;
}

// ─── PR 2: theming ──────────────────────────────────────────────────────────

/**
 * Resolved landing-page theme. Every field is guaranteed present after
 * resolveTheme() — components never see undefined. Source jsonb keys use
 * the same snake_case names on client_landing_pages.theme /
 * page_events.theme_overrides.
 */
export interface LandingPageTheme {
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  bg_color: string;
  text_color: string;
  font_family: string;
  /** Absolute http(s) URL or null — rendered as <img>, never as CSS url(). */
  logo_url: string | null;
  thank_you_message: string;
}

// ─── PR 2: signup form ──────────────────────────────────────────────────────

/**
 * Raw (untrusted) form values as posted by the client.
 *
 * PR 6 dropped first_name / last_name / city (Supreme-minimal fields).
 * Legacy payloads that still carry them are IGNORED, not rejected — a
 * stale cached bundle mid-deploy must not 400 a fan's signup.
 */
export interface SignupFormValues {
  email?: unknown;
  phone?: unknown;
  /** ISO 3166-1 alpha-2, e.g. 'GB' — drives E.164 parsing. */
  phone_country?: unknown;
  /** PR 6 mutex: at most ONE of ig_handle / tt_handle may be set. */
  ig_handle?: unknown;
  tt_handle?: unknown;
  consent_gdpr?: unknown;
  consent_wa_opt_in?: unknown;
  /** Attribution payload captured client-side (sessionStorage first-touch). */
  utm?: unknown;
  referrer_url?: unknown;
  /** Cloudflare Turnstile token (absent in dev when keys unset). */
  captcha_token?: unknown;
  /**
   * Client-generated Meta event id shared by the browser
   * CompleteRegistration event and the server CAPI event so Meta dedups
   * the pair. Optional — the server generates one when absent (older
   * cached bundles, pixel-less tenants).
   */
  capi_event_id?: unknown;
}

/** Validated + normalised submission (output of parseSignupSubmission). */
export interface SignupSubmission {
  /** Lowercased, trimmed. At least one of email / phone_e164 is non-null. */
  email: string | null;
  phone_e164: string | null;
  phone_country_code: string | null;
  /** Lowercased, @ stripped. At most one of ig/tt is non-null (PR-6 mutex). */
  ig_handle: string | null;
  tt_handle: string | null;
  consent_wa_opt_in: boolean;
  utm: Record<string, string>;
  referrer_url: string | null;
  source: string | null;
  /** PR 3: validated Meta event id ([A-Za-z0-9._:-]{8,64}) or null. */
  capi_event_id: string | null;
}

/**
 * Coarse request geo, derived SERVER-SIDE from Vercel's IP-geo headers
 * (x-vercel-ip-country / -country-region / -city) — never from the form
 * body. Stored plaintext on event_signups (aggregate analytics) and fed
 * hashed into Meta CAPI user_data.country / .st.
 */
export interface SignupGeo {
  /** ISO 3166-1 alpha-2, uppercased ("GB"). */
  country: string | null;
  /** Region code ("ENG", "TX"). */
  region: string | null;
  /** Decoded city name. */
  city: string | null;
}

/**
 * Debug outcome of the server-side Meta CAPI fire, echoed in the signup
 * response so failures are diagnosable via curl (design: CAPI never blocks
 * signup success — `ok:false` here still ships with a 200 signup).
 */
export interface SignupCapiDebug {
  ok: boolean;
  fbtrace_id?: string;
  error?: string;
  skipped?: string;
}

/** JSON contract of POST /api/l/[clientSlug]/[eventSlug]/signup. */
export type SubmitSignupResult =
  | {
      ok: true;
      signup_id: string;
      deduplicated: boolean;
      capi?: SignupCapiDebug;
    }
  | { ok: false; error: string; field_errors?: Record<string, string> };

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
