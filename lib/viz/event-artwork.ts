/**
 * Resolve event artwork from sources that already exist in-app.
 * Never calls Meta. A missing URL is initials, not a fetch.
 */

export function firstHttpUrl(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstHttpUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return firstHttpUrl(rec.url ?? rec.artwork_url ?? rec.src ?? rec.href);
  }
  return null;
}

export function resolveEventArtwork(sources: {
  heroImages?: unknown;
  pageContent?: Record<string, unknown> | null;
  d2cArtworkUrl?: string | null;
  registryThumbnailUrl?: string | null;
}): string | null {
  return (
    firstHttpUrl(sources.heroImages) ??
    firstHttpUrl(sources.pageContent?.artwork_url) ??
    firstHttpUrl(sources.d2cArtworkUrl) ??
    firstHttpUrl(sources.registryThumbnailUrl)
  );
}

export function eventInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}
