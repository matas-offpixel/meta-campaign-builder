/** Mutates merged POST body: legacy `urlContains` string → string[]. */
export function coerceLegacyWebsitePixelUrlStringToArray(
  meta: Record<string, unknown>,
): void {
  if (
    meta.subtype === "website_pixel" &&
    "urlContains" in meta &&
    typeof meta.urlContains === "string"
  ) {
    meta.urlContains = meta.urlContains ? [meta.urlContains] : [];
  }
}

/** Strip scheme for Meta `i_contains` URL filters (full URLs in Events Manager omit https://). */
export function stripHttpSchemeFromPixelUrlFragment(fragment: string): string {
  return fragment.replace(/^https?:\/\//i, "").trim();
}

/** Normalize pixel URL fragments from API / DB (string, string[], newline-separated). */
export function normalizeWebsitePixelUrlContains(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw
      .flatMap((s) => String(s).split("\n"))
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}
