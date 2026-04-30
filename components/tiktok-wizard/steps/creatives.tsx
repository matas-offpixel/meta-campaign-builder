"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  extractTikTokVideoId,
  nameCreativeVariations,
  type TikTokVideoInfo,
} from "@/lib/tiktok/creative";
import type {
  TikTokCampaignDraft,
  TikTokCreativeDraft,
} from "@/lib/types/tiktok-draft";

const CTA_OPTIONS = [
  { value: "LEARN_MORE", label: "Learn more" },
  { value: "BOOK_NOW", label: "Book now" },
  { value: "BUY_TICKETS", label: "Buy tickets" },
  { value: "SIGN_UP", label: "Sign up" },
  { value: "DOWNLOAD", label: "Download" },
];

export function CreativesStep({
  draft,
  onSave,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
}) {
  const [baseName, setBaseName] = useState("TikTok creative");
  const [videoInput, setVideoInput] = useState("");
  const [adText, setAdText] = useState("");
  const [landingPageUrl, setLandingPageUrl] = useState("");
  const [cta, setCta] = useState("LEARN_MORE");
  const [variationCount, setVariationCount] = useState("1");
  const [saving, setSaving] = useState(false);
  const [videoLookupLoading, setVideoLookupLoading] = useState(false);
  const [retryVideoId, setRetryVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(items: TikTokCreativeDraft[]) {
    setSaving(true);
    setError(null);
    try {
      await onSave({ creatives: { ...draft.creatives, items } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save creatives");
    } finally {
      setSaving(false);
    }
  }

  async function addVideoReference() {
    const videoId = extractTikTokVideoId(videoInput);
    if (!videoId) {
      setError("Paste a TikTok video URL or video_id.");
      return;
    }
    if (adText.length > 100) {
      setError("TikTok ad text must be 100 characters or fewer.");
      return;
    }
    const count = Math.max(1, Math.min(10, Number.parseInt(variationCount, 10) || 1));
    const videoInfo = await loadVideoInfo(videoId);
    if (!videoInfo) return;
    const names = nameCreativeVariations(baseName, count);
    const displayName =
      draft.accountSetup.identityDisplayName ??
      draft.accountSetup.identityManualName ??
      "";
    const nextItems: TikTokCreativeDraft[] = [
      ...draft.creatives.items,
      ...names.map((name) => ({
        id: crypto.randomUUID(),
        name,
        baseName: baseName.trim() || "TikTok creative",
        mode: "VIDEO_REFERENCE" as const,
        videoId,
        videoUrl: videoInput.trim(),
        thumbnailUrl: videoInfo?.thumbnail_url ?? null,
        durationSeconds: videoInfo?.duration_seconds ?? null,
        title: videoInfo?.title ?? null,
        sparkPostId: null,
        caption: adText,
        adText,
        displayName,
        landingPageUrl: landingPageUrl.trim(),
        cta,
        musicId: null,
      })),
    ];
    await persist(nextItems);
  }

  async function loadVideoInfo(videoId: string): Promise<TikTokVideoInfo | null> {
    const advertiserId = draft.accountSetup.advertiserId;
    if (!advertiserId) return null;
    setVideoLookupLoading(true);
    setRetryVideoId(null);
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      video_id: videoId,
    });
    try {
      const res = await fetch(`/api/tiktok/creative/video-info?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; videos?: TikTokVideoInfo[]; error?: string }
        | null;
      if (!json?.ok) {
        const message = json?.error ?? "Could not validate video.";
        if (isRateLimitMessage(message)) {
          setRetryVideoId(videoId);
          setError("TikTok video API is rate limited. Try again in a moment.");
          return null;
        }
        if (isVideoNotFoundMessage(message)) {
          setError("Video not found in this advertiser. Check the URL or video ID.");
          return null;
        }
        setError(message);
        return null;
      }
      const video = json.videos?.[0] ?? null;
      if (!video) {
        setError("Video not found in this advertiser. Check the URL or video ID.");
      }
      return video;
    } finally {
      setVideoLookupLoading(false);
    }
  }

  async function removeCreative(id: string) {
    await persist(draft.creatives.items.filter((item) => item.id !== id));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Creatives</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Add video-reference creatives. Spark Ads are shown as a v2 placeholder
          and are not wired in this version.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <p>{error}</p>
          {retryVideoId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              disabled={videoLookupLoading}
              onClick={() => void loadVideoInfo(retryVideoId)}
            >
              Retry video lookup
            </Button>
          )}
        </div>
      )}

      <fieldset className="space-y-4 rounded-md border border-border bg-background p-4">
        <legend className="px-1 text-sm font-medium">Creative mode</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked readOnly />
          Video reference
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="radio" disabled />
          Spark Ad — Coming in v2: boost an existing organic post.
        </label>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id="creative-base-name"
          label="Base creative name"
          value={baseName}
          onChange={(event) => setBaseName(event.target.value)}
          placeholder="Prospecting video"
        />
        <Input
          id="creative-variation-count"
          label="Variations"
          inputMode="numeric"
          value={variationCount}
          onChange={(event) => setVariationCount(event.target.value)}
          placeholder="1"
        />
      </div>

      <Input
        id="creative-video"
        label="TikTok video URL or video_id"
        value={videoInput}
        onChange={(event) => setVideoInput(event.target.value)}
        placeholder="https://www.tiktok.com/@brand/video/123..."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id="creative-ad-text"
          label="Ad text (max 100 chars)"
          value={adText}
          maxLength={100}
          onChange={(event) => setAdText(event.target.value)}
          placeholder="Book tickets now"
        />
        <p className="self-end text-xs text-muted-foreground">
          {adText.length}/100 characters
        </p>
        <Input
          id="creative-landing-page"
          label="Landing page URL"
          value={landingPageUrl}
          onChange={(event) => setLandingPageUrl(event.target.value)}
          placeholder="https://..."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id="creative-display-name"
          label="Display name"
          value={
            draft.accountSetup.identityDisplayName ??
            draft.accountSetup.identityManualName ??
            ""
          }
          readOnly
        />
        <Select
          id="creative-cta"
          label="CTA"
          value={cta}
          onChange={(event) => setCta(event.target.value)}
          options={CTA_OPTIONS}
        />
      </div>

      <Button
        type="button"
        onClick={() => void addVideoReference()}
        disabled={saving || videoLookupLoading}
      >
        Add creative variation{variationCount === "1" ? "" : "s"}
      </Button>

      <div className="space-y-3">
        {draft.creatives.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-md border border-border bg-background p-3"
          >
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt=""
                className="h-14 w-14 rounded object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                Video
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {item.videoId} · {item.cta ?? "No CTA"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {item.adText || "No ad text"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void removeCreative(item.id)}
              disabled={saving}
            >
              Remove
            </Button>
          </div>
        ))}
        {draft.creatives.items.length === 0 && (
          <p className="text-sm text-muted-foreground">No creatives added yet.</p>
        )}
      </div>
    </div>
  );
}

function isRateLimitMessage(message: string): boolean {
  return message.includes("50001") || message.toLowerCase().includes("rate");
}

function isVideoNotFoundMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("404") || lower.includes("not found");
}
