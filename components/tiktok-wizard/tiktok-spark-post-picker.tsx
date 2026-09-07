"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Datum } from "@/components/steps/step-surface";
import {
  formatTikTokSparkAuthExpired,
  isTikTokSparkAuthExpired,
  sparkPostPreviewCause,
  TIKTOK_SPARK_POST_COPY,
  type TikTokSparkPost,
} from "@/lib/tiktok/spark-posts";
import { tiktokSparkPosterUrl } from "@/lib/tiktok/video-preview";

function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, "0")}` : `${total}s`;
}

interface SparkResponse {
  ok?: boolean;
  posts?: TikTokSparkPost[];
  page?: number;
  total_page?: number;
  error?: string;
}

export function TikTokSparkPostPicker({
  advertiserId,
  disabled = false,
  onPick,
}: {
  advertiserId: string | null;
  disabled?: boolean;
  onPick: (posts: TikTokSparkPost[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<TikTokSparkPost[]>([]);
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
      const res = await fetch(`/api/tiktok/creative/spark-posts?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as SparkResponse | null;
      if (!json?.ok) {
        setError(json?.error ?? "Could not load posts.");
        return;
      }
      setPosts((current) => (append ? [...current, ...(json.posts ?? [])] : (json.posts ?? [])));
      setPage(json.page ?? nextPage);
      setTotalPage(json.total_page ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load posts.");
    } finally {
      setLoading(false);
    }
  }

  async function openPicker() {
    if (!advertiserId) return;
    setOpen(true);
    setSelected([]);
    await loadPage(1, false);
  }

  function toggle(itemId: string) {
    setSelected((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  function addSelected() {
    const picked = posts.filter(
      (post) => selected.includes(post.item_id) && !isTikTokSparkAuthExpired(post),
    );
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
        onClick={() => void (open ? setOpen(false) : openPicker())}
      >
        {TIKTOK_SPARK_POST_COPY.choose}
      </Button>

      {open ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          {error ? <Datum className="text-sm text-amber-700 dark:text-amber-300">{error}</Datum> : null}
          {loading && posts.length === 0 ? (
            <Datum className="text-sm text-muted-foreground">loading…</Datum>
          ) : null}
          {!loading && posts.length === 0 && !error ? (
            <Datum className="text-sm text-muted-foreground">
              {TIKTOK_SPARK_POST_COPY.empty}
            </Datum>
          ) : null}
          {posts.length > 0 ? (
            <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {posts.map((post) => {
                const expired = isTikTokSparkAuthExpired(post, now);
                const cause = sparkPostPreviewCause(post, now);
                const thumb = expired ? null : tiktokSparkPosterUrl(post, now);
                const active = selected.includes(post.item_id);
                const duration = formatDuration(post.duration_seconds);
                return (
                  <button
                    key={post.item_id}
                    type="button"
                    disabled={expired}
                    onClick={() => toggle(post.item_id)}
                    className={`overflow-hidden rounded-md border text-left ${
                      expired
                        ? "cursor-not-allowed border-border opacity-60"
                        : active
                          ? "border-primary ring-1 ring-primary"
                          : "border-border"
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
                      <div className="flex aspect-[9/16] items-center justify-center bg-muted px-2 text-center text-xs text-muted-foreground">
                        {cause === "expired"
                          ? formatTikTokSparkAuthExpired(post.auth_end_time)
                          : cause === "not_public"
                            ? TIKTOK_SPARK_POST_COPY.notPublic
                            : "Video"}
                      </div>
                    )}
                    <div className="space-y-0.5 p-2">
                      <Datum className="truncate text-xs font-medium">
                        {post.text || post.item_id}
                      </Datum>
                      {expired ? (
                        <Datum className="text-xs text-muted-foreground">
                          {formatTikTokSparkAuthExpired(post.auth_end_time)}
                        </Datum>
                      ) : duration ? (
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
