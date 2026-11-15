/**
 * lib/google-video/youtube-url.ts
 *
 * Reads a YouTube video or channel out of a sheet cell. Accepts
 * `watch?v=`, `youtu.be/ID`, `/shorts/ID`, `/embed/ID`, `/@handle` and
 * `/channel/UC…`, with or without a scheme or `www.`/`m.`. Tracking
 * params (`si`, `t`, `list`, …) are dropped. Anything else, including a
 * title or an instruction, is null.
 */

import type { GoogleVideoPlacementKind } from "./types.ts";

export interface YouTubeRef {
  kind: GoogleVideoPlacementKind;
  /** 11-char video id, `UC…` channel id, or `@handle`. */
  id: string;
  /** Canonical URL with no tracking params. */
  url: string;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[A-Za-z0-9._-]{1,100}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

function videoRef(id: string): YouTubeRef | null {
  return VIDEO_ID.test(id) ? { kind: "video", id, url: `https://www.youtube.com/watch?v=${id}` } : null;
}

export function parseYouTubeRef(raw: unknown): YouTubeRef | null {
  const text = String(raw ?? "").trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") return segments.length === 1 ? videoRef(segments[0]) : null;
  if (!HOSTS.has(host)) return null;

  const [first, second] = segments;
  if (first === "watch") return videoRef(url.searchParams.get("v") ?? "");
  if ((first === "shorts" || first === "embed" || first === "live") && second) return videoRef(second);
  if (first === "channel" && second && CHANNEL_ID.test(second)) {
    return { kind: "channel", id: second, url: `https://www.youtube.com/channel/${second}` };
  }
  if (first && HANDLE.test(decodeURIComponent(first))) {
    const handle = decodeURIComponent(first);
    return { kind: "handle", id: handle, url: `https://www.youtube.com/${handle}` };
  }
  return null;
}

/** A video id from a video link or a bare 11-char id. Channels are not videos. */
export function videoIdFrom(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (VIDEO_ID.test(text)) return text;
  const ref = parseYouTubeRef(text);
  return ref?.kind === "video" ? ref.id : null;
}

/** First YouTube link inside free text, e.g. a note: `From youtube.com/watch?v=…`. */
export function findYouTubeRef(text: unknown): YouTubeRef | null {
  for (const token of String(text ?? "").split(/[\s,;()]+/)) {
    if (!/youtu/i.test(token)) continue;
    const ref = parseYouTubeRef(token.replace(/[.,;:!?'"]+$/, ""));
    if (ref) return ref;
  }
  return null;
}
