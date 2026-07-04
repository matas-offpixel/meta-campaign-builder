/**
 * lib/landing-pages/youtube.ts
 *
 * PURE YouTube URL → video-id parsing for the bottom lite-embed. Handles
 * the three shapes operators actually paste:
 *
 *   https://www.youtube.com/watch?v={id}
 *   https://youtu.be/{id}
 *   https://www.youtube.com/embed/{id}
 *
 * Anything else (or a malformed id) → null → the embed does not render.
 * The id feeds both the thumbnail URL and the iframe src, so the strict
 * charset check doubles as injection defence.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

export function parseYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (parsed.pathname === "/watch") {
      candidate = parsed.searchParams.get("v");
    } else if (segments[0] === "embed" || segments[0] === "shorts") {
      candidate = segments[1] ?? null;
    }
  }

  return candidate && VIDEO_ID_RE.test(candidate) ? candidate : null;
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
}
