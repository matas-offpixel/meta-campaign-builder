/**
 * lib/admin/branding-schema.ts
 *
 * Pure validation + payload-building for the org/brand settings editor
 * (OP909 Phase 2). No imports, no Next/Supabase coupling — node:test
 * exercises every branch directly, and the server action
 * (lib/actions/update-client-branding.ts) stays a thin authenticated
 * shell around this module.
 *
 * Every field that ends up on the fan-facing LP goes through the same
 * character-level discipline as lib/landing-pages/theme.ts — the admin
 * UI is a second WRITE path into the theme jsonb, so a hostile value
 * must die here, not rely on the renderer's read-time sanitiser alone.
 */

export interface BrandingFormValues {
  logo_style: "box_logo" | "wordmark";
  /** null clears the text (renderer falls back to client name). */
  box_logo_text: string | null;
  /** Hex only (#rgb/#rrggbb) — written to theme.primary_color. */
  brand_color: string | null;
  /** https:// required (fan-facing consent link). null clears. */
  privacy_policy_url: string | null;
  brand_instagram_url_default: string | null;
  brand_tiktok_url_default: string | null;
  show_off_pixel_attribution: boolean;
}

export type BrandingParseResult =
  | { ok: true; value: BrandingFormValues }
  | { ok: false; errors: Record<string, string> };

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Trim to null — empty inputs mean "clear this field". */
function emptyToNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validHttpUrl(
  raw: string,
  { httpsOnly }: { httpsOnly: boolean },
): boolean {
  if (raw.length > 2000) return false;
  try {
    const url = new URL(raw);
    if (httpsOnly) return url.protocol === "https:";
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Parse + validate the settings form. All-or-nothing: any invalid field
 * fails the whole parse (the form re-renders with per-field errors).
 */
export function parseBrandingForm(
  input: Record<string, unknown>,
): BrandingParseResult {
  const errors: Record<string, string> = {};

  const logoStyle = input.logo_style;
  if (logoStyle !== "box_logo" && logoStyle !== "wordmark") {
    errors.logo_style = "Choose box logo or wordmark.";
  }

  const boxLogoText = emptyToNull(input.box_logo_text);
  if (boxLogoText !== null && boxLogoText.length > 16) {
    errors.box_logo_text = "Keep the box logo text under 16 characters.";
  }

  const brandColor = emptyToNull(input.brand_color);
  if (brandColor !== null && !HEX_COLOR_RE.test(brandColor)) {
    errors.brand_color = "Use a hex color like #E5322D.";
  }

  const privacyUrl = emptyToNull(input.privacy_policy_url);
  if (privacyUrl !== null && !validHttpUrl(privacyUrl, { httpsOnly: true })) {
    errors.privacy_policy_url = "Must be a valid https:// URL.";
  }

  const igUrl = emptyToNull(input.brand_instagram_url_default);
  if (igUrl !== null && !validHttpUrl(igUrl, { httpsOnly: false })) {
    errors.brand_instagram_url_default = "Must be a valid http(s) URL.";
  }

  const ttUrl = emptyToNull(input.brand_tiktok_url_default);
  if (ttUrl !== null && !validHttpUrl(ttUrl, { httpsOnly: false })) {
    errors.brand_tiktok_url_default = "Must be a valid http(s) URL.";
  }

  const attribution = input.show_off_pixel_attribution;
  const showAttribution =
    attribution === true || attribution === "true" || attribution === "on";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      logo_style: logoStyle as "box_logo" | "wordmark",
      box_logo_text: boxLogoText,
      brand_color: brandColor,
      privacy_policy_url: privacyUrl,
      brand_instagram_url_default: igUrl,
      brand_tiktok_url_default: ttUrl,
      show_off_pixel_attribution: showAttribution,
    },
  };
}

/**
 * Build the client_landing_pages UPDATE payload from parsed values + the
 * row's CURRENT theme jsonb. brand_color merges into theme.primary_color
 * (all other theme keys preserved verbatim — the settings form owns ONE
 * key, it must never flatten an operator-authored theme). brand_color
 * null removes the key so the renderer's DEFAULT_ACCENT chain applies.
 */
export function buildBrandingUpdate(
  currentTheme: Record<string, unknown> | null | undefined,
  values: BrandingFormValues,
): Record<string, unknown> {
  const theme: Record<string, unknown> = { ...(currentTheme ?? {}) };
  if (values.brand_color === null) {
    delete theme.primary_color;
  } else {
    theme.primary_color = values.brand_color;
  }

  // No updated_at here — the client_landing_pages_updated_at trigger
  // (migration 132) stamps it on every UPDATE.
  return {
    logo_style: values.logo_style,
    box_logo_text: values.box_logo_text,
    theme,
    privacy_policy_url: values.privacy_policy_url,
    brand_instagram_url_default: values.brand_instagram_url_default,
    brand_tiktok_url_default: values.brand_tiktok_url_default,
    show_off_pixel_attribution: values.show_off_pixel_attribution,
  };
}
