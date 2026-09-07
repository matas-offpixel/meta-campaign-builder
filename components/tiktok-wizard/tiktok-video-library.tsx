"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Datum } from "@/components/steps/step-surface";
import {
  TIKTOK_VIDEO_LIBRARY_COPY,
  type TikTokVideoInfo,
} from "@/lib/tiktok/creative";
import { tiktokLibraryThumbUrl } from "@/lib/tiktok/video-preview";

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `${total}s`;
}

interface LibraryResponse {
  ok?: boolean;
  videos?: TikTokVideoInfo[];
  page?: number;
  total_page?: number;
  error?: string;
}

export function TikTokVideoLibrary({
  advertiserId,
  disabled = false,
  onPick,
}: {
  advertiserId: string | null;
  disabled?: boolean;
  onPick: (videos: TikTokVideoInfo[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [videos, setVideos] = useState<TikTokVideoInfo[]>([]);
  const [page, setPage] = useState(0);
  const [totalPage, setTotalPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  async function loadPage(nextPage: number, append: boolean) {
    if (!advertiserId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      page: String(nextPage),
      page_size: "20",
    });
    try {
      const res = await fetch(`/api/tiktok/creative/videos?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as LibraryResponse | null;
      if (!json?.ok) {
        setError(json?.error ?? "Could not load videos.");
        return;
      }
      setVideos((current) => (append ? [...current, ...(json.videos ?? [])] : (json.videos ?? [])));
      setPage(json.page ?? nextPage);
      setTotalPage(json.total_page ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load videos.");
    } finally {
      setLoading(false);
    }
  }

  async function openLibrary() {
    if (!advertiserId) return;
    setOpen(true);
    setSelected([]);
    await loadPage(1, false);
  }

  function toggle(videoId: string) {
    setSelected((current) =>
      current.includes(videoId)
        ? current.filter((id) => id !== videoId)
        : [...current, videoId],
    );
  }

  function addSelected() {
    const picked = videos.filter((video) => selected.includes(video.video_id));
    if (picked.length === 0) return;
    onPick(picked);
    setSelected([]);
  }

  const now = Date.now();
  const hasMore = page > 0 && totalPage > page;

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !advertiserId || loading}
        onClick={() => void (open ? setOpen(false) : openLibrary())}
      >
        {TIKTOK_VIDEO_LIBRARY_COPY.choose}
      </Button>

      {open ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          {error ? <Datum className="text-sm text-amber-700 dark:text-amber-300">{error}</Datum> : null}
          {loading && videos.length === 0 ? (
            <Datum className="text-sm text-muted-foreground">loading…</Datum>
          ) : null}
          {!loading && videos.length === 0 && !error ? (
            <Datum className="text-sm text-muted-foreground">
              {TIKTOK_VIDEO_LIBRARY_COPY.empty}
            </Datum>
          ) : null}
          {videos.length > 0 ? (
            <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {videos.map((video) => {
                const thumb = tiktokLibraryThumbUrl(video, now);
                const active = selected.includes(video.video_id);
                const duration = formatDuration(video.duration_seconds);
                return (
                  <button
                    key={video.video_id}
                    type="button"
                    onClick={() => toggle(video.video_id)}
                    className={`overflow-hidden rounded-md border text-left ${
                      active ? "border-primary ring-1 ring-primary" : "border-border"
                    }`}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="aspect-[9/16] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[9/16] items-center justify-center bg-muted text-xs text-muted-foreground">
                        Video
                      </div>
                    )}
                    <div className="space-y-0.5 p-2">
                      <Datum className="truncate text-xs font-medium">
                        {video.title || video.video_id}
                      </Datum>
                      {duration ? (
                        <Datum className="text-xs text-muted-foreground">{duration}</Datum>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={disabled || selected.length === 0}
              onClick={addSelected}
            >
              {selected.length > 1 ? `add ${selected.length}` : "add"}
            </Button>
            {hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void loadPage(page + 1, true)}
              >
                more
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
