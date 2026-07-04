"use client";

import { useState } from "react";

import {
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "@/lib/landing-pages/youtube";

import styles from "./landing-page.module.css";

/**
 * components/landing-pages/bottom-media.tsx
 *
 * Bottom media block (PR 6): YouTube lite-embed + image grid.
 *
 * Lite-embed pattern: render only the thumbnail + play overlay until the
 * fan CLICKS — no YouTube iframe/JS is loaded pre-gesture (fast page, and
 * autoplay=1 in the swapped-in iframe is honoured because it follows a
 * user gesture). URL → id parsing happens upstream in the view model
 * (lib/landing-pages/youtube.ts); this component only ever sees a
 * validated id.
 *
 * Image grid: 2 columns mobile / 4 desktop (CSS media query), square
 * crops, zero gap, zero radius. Click opens the raw image in a new tab.
 */

export function BottomMedia({
  videoId,
  images,
  eventName,
}: {
  videoId: string | null;
  images: string[];
  eventName: string;
}) {
  if (!videoId && images.length === 0) return null;

  return (
    <section aria-label="Media">
      {videoId ? <YouTubeLiteEmbed videoId={videoId} title={eventName} /> : null}
      {images.length > 0 ? (
        <div className={styles.imageGrid}>
          {images.map((src, index) => (
            <button
              key={`${index}-${src}`}
              type="button"
              className={styles.gridImage}
              onClick={() => window.open(src, "_blank", "noopener")}
              aria-label={`Open image ${index + 1} of ${images.length}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external, operator-provided URL */}
              <img
                className={styles.gridImage}
                src={src}
                alt={`${eventName} — ${index + 1}`}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function YouTubeLiteEmbed({
  videoId,
  title,
}: {
  videoId: string;
  title: string;
}) {
  const [activated, setActivated] = useState(false);

  if (activated) {
    return (
      <iframe
        className={styles.youtubeFrame}
        src={youtubeEmbedUrl(videoId)}
        title={title}
        allow="autoplay; encrypted-media"
        allowFullScreen
      />
    );
  }

  return (
    <button
      type="button"
      className={styles.youtubeWrap}
      onClick={() => setActivated(true)}
      aria-label={`Play video: ${title}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumbnail */}
      <img
        className={styles.youtubeThumb}
        src={youtubeThumbnailUrl(videoId)}
        alt=""
        loading="lazy"
      />
      <PlayIcon />
    </button>
  );
}

function PlayIcon() {
  return (
    <svg
      className={styles.youtubePlay}
      viewBox="0 0 52 36"
      aria-hidden="true"
    >
      <rect width="52" height="36" fill="#000000" fillOpacity="0.75" />
      <polygon points="20,9 20,27 36,18" fill="#ffffff" />
    </svg>
  );
}
