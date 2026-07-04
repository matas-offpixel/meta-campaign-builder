import type { LandingPageTheme } from "./types.ts";

/**
 * lib/landing-pages/theme.ts
 *
 * Theme resolution for the /l renderer. Pure — unit-tested directly,
 * including the tenant-isolation test.
 *
 * Merge order (lowest → highest precedence):
 *   defaults → client_landing_pages.theme → page_events.theme_overrides
 *
 * SECURITY: theme values come from a jsonb column that is operator-edited
 * today but will be admin-UI-edited later. Every value is sanitised before
 * it becomes a CSS custom property — a hostile value like
 * `red;} body{display:none` or `url(javascript:…)` must never reach the
 * style attribute. Values that fail sanitisation fall back to the default
 * (never to another tenant's value — themes resolve strictly from the
 * single context passed in).
 */

/** Bright, UGC-friendly defaults (4tF/Ironworks visual precedent). */
export const DEFAULT_LANDING_THEME: LandingPageTheme = {
  primary_color: "#ff4f30",
  secondary_color: "#241f31",
  accent_color: "#ffd23f",
  bg_color: "#fff8f1",
  text_color: "#1c1a1f",
  font_family:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  logo_url: null,
  thank_you_message: "Thanks for signing up — we'll be in touch.",
};

// #rgb/#rrggbb/#rrggbbaa, rgb()/rgba()/hsl()/hsla() with safe characters.
const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/deg-]+\s*\))$/;

// Letters, digits, spaces, commas, hyphens, straight quotes. No ; { } ( ) \ url.
const FONT_FAMILY_RE = /^[a-zA-Z0-9\s,'"-]{1,200}$/;

function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && COLOR_RE.test(value.trim())
    ? value.trim()
    : fallback;
}

function safeFontFamily(value: unknown, fallback: string): string {
  return typeof value === "string" && FONT_FAMILY_RE.test(value.trim())
    ? value.trim()
    : fallback;
}

function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

function safeMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  // Rendered as a React text node (escaped) — length is the only concern.
  return trimmed.length > 0 && trimmed.length <= 500 ? trimmed : fallback;
}

/**
 * Merge + sanitise client theme and per-event overrides into a fully
 * populated LandingPageTheme. Unknown keys are ignored; invalid values fall
 * back per-key to the default (never partially to the client value — an
 * invalid override falls back to the CLIENT value first, then default).
 */
export function resolveTheme(
  clientTheme: Record<string, unknown> | null | undefined,
  eventOverrides: Record<string, unknown> | null | undefined,
): LandingPageTheme {
  const c = clientTheme ?? {};
  const o = eventOverrides ?? {};
  const d = DEFAULT_LANDING_THEME;

  const pick = (key: string): unknown => (key in o ? o[key] : c[key]);

  return {
    primary_color: safeColor(
      pick("primary_color"),
      safeColor(c["primary_color"], d.primary_color),
    ),
    secondary_color: safeColor(
      pick("secondary_color"),
      safeColor(c["secondary_color"], d.secondary_color),
    ),
    accent_color: safeColor(
      pick("accent_color"),
      safeColor(c["accent_color"], d.accent_color),
    ),
    bg_color: safeColor(pick("bg_color"), safeColor(c["bg_color"], d.bg_color)),
    text_color: safeColor(
      pick("text_color"),
      safeColor(c["text_color"], d.text_color),
    ),
    font_family: safeFontFamily(
      pick("font_family"),
      safeFontFamily(c["font_family"], d.font_family),
    ),
    logo_url: safeLogoUrl(pick("logo_url")) ?? safeLogoUrl(c["logo_url"]),
    thank_you_message: safeMessage(
      pick("thank_you_message"),
      safeMessage(c["thank_you_message"], d.thank_you_message),
    ),
  };
}

/**
 * CSS custom properties for the LP container. Applied as an inline style on
 * the LandingPage ROOT element only — CSS variables inherit down the
 * subtree and cannot leak to siblings/globals, which is the scoping
 * mechanism the isolation contract relies on.
 */
export function buildThemeStyle(
  theme: LandingPageTheme,
): Record<string, string> {
  return {
    "--lp-primary-color": theme.primary_color,
    "--lp-secondary-color": theme.secondary_color,
    "--lp-accent-color": theme.accent_color,
    "--lp-bg-color": theme.bg_color,
    "--lp-text-color": theme.text_color,
    "--lp-font-family": theme.font_family,
  };
}
