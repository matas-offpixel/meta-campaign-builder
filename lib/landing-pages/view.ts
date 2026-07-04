import { parseStoredPalette } from "./palette.ts";
import { buildThemeStyle, resolveAccent, resolveTheme } from "./theme.ts";
import type { LandingPageContext, LandingPageTheme } from "./types.ts";
import { parseYouTubeId } from "./youtube.ts";

/**
 * lib/landing-pages/view.ts
 *
 * Pure context → view-model builder for the /l renderer. Components consume
 * ONLY this shape; nothing in the component tree reaches back into the raw
 * context. That makes the tenant-isolation guarantee testable in one place:
 * `buildLandingPageView(contextA)` must contain nothing of tenant B — see
 * lib/landing-pages/__tests__/theme-isolation.test.ts.
 *
 * PR 3: `metaPixelId` flows through this seam (the explicit, tested field
 * PR 2 reserved). It is STILL the only pixel-shaped value the renderer can
 * see, and it comes exclusively from `context.landingPage.meta_pixel_id`.
 *
 * PR 6 (Supreme UX): the seam grows accent / carousel / countdown / media /
 * logo / footer fields. Same rule as ever — every value resolves strictly
 * from the single context passed in; URL-shaped values are sanitised here
 * so components never validate.
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

  // ── PR 6: Supreme renderer fields ──
  /** Sanitised accent hex — artwork palette → client primary → default. */
  accent: string;
  /** Hero carousel URLs; falls back to [artworkUrl] when unset. */
  heroImages: string[];
  /** Null hides the countdown block (unset target or already past — the
   *  component re-checks client-side so an SSR-cached page still hides). */
  countdown: { targetAt: string; label: string } | null;
  /** Parsed YouTube video id (null hides the embed). */
  youtubeVideoId: string | null;
  /** Bottom image-grid URLs (empty hides the grid). */
  bottomImages: string[];
  logoStyle: "box_logo" | "wordmark";
  /** Box-logo text; falls back to the client name. */
  boxLogoText: string;
  /** Consent-line privacy policy link (null → no link rendered). */
  privacyPolicyUrl: string | null;
  /** Footer attribution toggle (client_landing_pages.show_off_pixel_attribution). */
  showOffPixelAttribution: boolean;
  /** Long-form description (content.description), mono body block. */
  description: string | null;
  /** Footer social links — only present entries render. */
  socialLinks: Array<{ label: string; url: string }>;
  /** Event capacity for the details line. */
  capacity: number | null;
  /**
   * PR 7: header on-sale timestamp source — event.presale_at, falling
   * back to event.general_sale_at. Null (both unset, or both unparseable)
   * hides the header meta row entirely. Raw ISO — formatting is a
   * component/format-datetime.ts concern, same split as every other
   * date field on this seam.
   */
  onSaleAt: string | null;
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

function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  if (trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

/** jsonb URL array → sanitised string[] (order preserved, junk dropped). */
function safeUrlArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => safeHttpUrl(entry))
    .filter((url): url is string => url !== null);
}

/** Parseable non-empty ISO string, or null (defensive — same pattern as
 *  the countdown gate below). */
function safeIsoTimestamp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

export function buildLandingPageView(
  context: LandingPageContext,
  /** Injectable clock (tests) — the countdown gate compares against it. */
  nowMs: number = Date.now(),
): LandingPageView {
  const theme = resolveTheme(
    context.landingPage?.theme ?? null,
    context.pageEvent.theme_overrides ?? null,
  );
  const content = context.pageEvent.content ?? {};
  const pageEvent = context.pageEvent;

  // events has no artwork column (audited 2026-07-04) — content is the
  // only source; PR 6 falls back to it when hero_images is empty.
  const artworkUrl = safeHttpUrl(contentString(content, "artwork_url"));
  const heroFromColumn = safeUrlArray(pageEvent.hero_images);
  const heroImages =
    heroFromColumn.length > 0
      ? heroFromColumn
      : artworkUrl
        ? [artworkUrl]
        : [];

  const palette = parseStoredPalette(pageEvent.artwork_palette);
  const accent = resolveAccent(palette, context.landingPage?.theme ?? null);

  const countdownTarget =
    typeof pageEvent.countdown_target_at === "string" &&
    !Number.isNaN(Date.parse(pageEvent.countdown_target_at)) &&
    Date.parse(pageEvent.countdown_target_at) > nowMs
      ? pageEvent.countdown_target_at
      : null;

  return {
    clientName: context.client.name,
    clientSlug: context.client.slug,
    eventSlug: context.event.slug,
    headline: contentString(content, "headline") ?? context.event.name,
    subtitle: contentString(content, "subtitle"),
    artworkUrl,
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

    accent,
    heroImages,
    countdown: countdownTarget
      ? {
          targetAt: countdownTarget,
          label:
            (pageEvent.countdown_label ?? "").trim() || "tickets on sale in",
        }
      : null,
    youtubeVideoId: parseYouTubeId(pageEvent.youtube_url),
    bottomImages: safeUrlArray(pageEvent.bottom_images),
    logoStyle: context.landingPage?.logo_style ?? "box_logo",
    boxLogoText:
      context.landingPage?.box_logo_text?.trim() || context.client.name,
    privacyPolicyUrl: safeHttpUrl(context.landingPage?.privacy_policy_url),
    showOffPixelAttribution:
      context.landingPage?.show_off_pixel_attribution ?? true,
    description: contentString(content, "description"),
    socialLinks: buildSocialLinks(content, context.event.ticket_url),
    capacity: context.event.capacity ?? null,
    onSaleAt:
      safeIsoTimestamp(context.event.presale_at) ??
      safeIsoTimestamp(context.event.general_sale_at),
  };
}

/**
 * Footer link row: instagram / tiktok from page content, tickets from the
 * event row. Only entries with a valid http(s) URL render.
 */
function buildSocialLinks(
  content: Record<string, unknown>,
  ticketUrl: string | null,
): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  const instagram = safeHttpUrl(contentString(content, "instagram_url"));
  if (instagram) links.push({ label: "instagram", url: instagram });
  const tiktok = safeHttpUrl(contentString(content, "tiktok_url"));
  if (tiktok) links.push({ label: "tiktok", url: tiktok });
  const tickets = safeHttpUrl(ticketUrl);
  if (tickets) links.push({ label: "tickets", url: tickets });
  return links;
}
