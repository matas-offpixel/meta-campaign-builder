import { buildThemeStyle, resolveTheme } from "./theme.ts";
import type { LandingPageContext, LandingPageTheme } from "./types.ts";

/**
 * lib/landing-pages/view.ts
 *
 * Pure context → view-model builder for the /l renderer. Components consume
 * ONLY this shape; nothing in the component tree reaches back into the raw
 * context. That makes the tenant-isolation guarantee testable in one place:
 * `buildLandingPageView(contextA)` must contain nothing of tenant B — see
 * lib/landing-pages/__tests__/theme-isolation.test.ts.
 *
 * PR 3: `metaPixelId` now flows through this seam (the explicit, tested
 * field PR 2 reserved). It is STILL the only pixel-shaped value the
 * renderer can see, and it comes exclusively from
 * `context.landingPage.meta_pixel_id` — the row resolved through the
 * clientSlug → client_id chain. Never from clients.meta_pixel_id
 * (Off/Pixel's operational pixel — design doc landmine 3), never from an
 * env var, never from a module-level default.
 */

export interface LandingPageView {
  clientName: string;
  clientSlug: string;
  eventSlug: string;
  headline: string;
  subtitle: string | null;
  artworkUrl: string | null;
  venueName: string | null;
  venueCity: string | null;
  /** ISO date (yyyy-mm-dd) — formatting is a component concern. */
  eventDate: string | null;
  presaleInfo: string | null;
  templateKey: string;
  /**
   * The TENANT's Meta Pixel id (client_landing_pages.meta_pixel_id) or
   * null = no pixel loads at all. There is no fallback source by design.
   */
  metaPixelId: string | null;
  theme: LandingPageTheme;
  /** CSS custom properties for the LP root element (scoped inheritance). */
  themeStyle: Record<string, string>;
  thankYouMessage: string;
}

function contentString(
  content: Record<string, unknown>,
  key: string,
): string | null {
  const value = content?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function safeArtworkUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

export function buildLandingPageView(
  context: LandingPageContext,
): LandingPageView {
  const theme = resolveTheme(
    context.landingPage?.theme ?? null,
    context.pageEvent.theme_overrides ?? null,
  );
  const content = context.pageEvent.content ?? {};

  return {
    clientName: context.client.name,
    clientSlug: context.client.slug,
    eventSlug: context.event.slug,
    headline: contentString(content, "headline") ?? context.event.name,
    subtitle: contentString(content, "subtitle"),
    // events has no artwork column (audited 2026-07-04) — content is the
    // only source; the hero renders a styled placeholder when null.
    artworkUrl: safeArtworkUrl(contentString(content, "artwork_url")),
    venueName: contentString(content, "venue_name") ?? context.event.venue_name,
    venueCity: contentString(content, "venue_city") ?? context.event.venue_city,
    eventDate: contentString(content, "event_date") ?? context.event.event_date,
    presaleInfo: contentString(content, "presale_info"),
    templateKey:
      context.template?.key ?? contentString(content, "template_key") ?? "mvp_v1",
    metaPixelId: context.landingPage?.meta_pixel_id ?? null,
    theme,
    themeStyle: buildThemeStyle(theme),
    thankYouMessage: theme.thank_you_message,
  };
}
