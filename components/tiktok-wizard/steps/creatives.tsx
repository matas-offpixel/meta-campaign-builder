"use client";

import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { uploadTikTokVideoViaStorage } from "@/lib/tiktok-wizard/campaign-asset-upload";
import {
  clampTikTokVariationCount,
  nextTikTokCreativeNames,
} from "@/lib/tiktok-wizard/creative-items";
import { refreshExpiredTikTokThumbnails } from "@/lib/tiktok-wizard/creative-thumbnails";
import {
  commitUploadedTikTokCreatives,
  formatTikTokCreativePersistFailure,
} from "@/lib/tiktok-wizard/persist-creatives";
import { validateTikTokVideoFile } from "@/lib/tiktok-wizard/video-constraints";
import {
  extractTikTokVideoId,
  type TikTokVideoInfo,
} from "@/lib/tiktok/creative";
import {
  isTikTokPreviewExpired,
  pickTikTokCoverUrl,
  resolveTikTokPreviewExpiry,
} from "@/lib/tiktok/video-preview";
import type {
  TikTokCampaignDraft,
  TikTokCreativeDraft,
} from "@/lib/types/tiktok-draft";
import { EventPageDestination } from "@/components/wizard/event-page-destination";

interface UploadJob {
  id: string;
  fileName: string;
  sizeLabel: string;
  stage: "storage" | "tiktok" | "saving" | "done" | "error";
  videoId: string | null;
  thumbnailUrl: string | null;
  error: string | null;
}

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
  const [isDragging, setIsDragging] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(draft.creatives.items);
  itemsRef.current = draft.creatives.items;
  const refreshingRef = useRef(false);

  async function persist(items: TikTokCreativeDraft[]): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onSave({ creatives: { ...draft.creatives, items } });
      itemsRef.current = items;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save creatives";
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    } finally {
      setSaving(false);
    }
  }

  function patchJob(id: string, patch: Partial<UploadJob>) {
    setUploadJobs((current) =>
      current.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    );
  }

  async function uploadFiles(files: File[]) {
    const advertiserId = draft.accountSetup.advertiserId;
    if (!advertiserId) {
      setError("Select an advertiser in Step 0 before uploading video.");
      return;
    }
    if (adText.length > 100) {
      setError("TikTok ad text must be 100 characters or fewer.");
      return;
    }
    const count = clampTikTokVariationCount(variationCount);
    for (const file of files) {
      const gate = validateTikTokVideoFile(file);
      if (!gate.ok) {
        setError(gate.error);
        setUploadJobs((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            fileName: file.name,
            sizeLabel: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
            stage: "error",
            videoId: null,
            thumbnailUrl: null,
            error: gate.error,
          },
        ]);
        continue;
      }
      const jobId = crypto.randomUUID();
      setUploadJobs((current) => [
        ...current,
        {
          id: jobId,
          fileName: file.name,
          sizeLabel: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
          stage: "storage",
          videoId: null,
          thumbnailUrl: null,
          error: null,
        },
      ]);
      try {
        const result = await uploadTikTokVideoViaStorage({
          file,
          advertiserId,
          onStage: (stage) => patchJob(jobId, { stage }),
        });
        const thumbnailUrl = pickTikTokCoverUrl({
          coverUrl: result.coverUrl,
          previewUrl: result.previewUrl,
        });
        patchJob(jobId, {
          stage: "saving",
          videoId: result.videoId,
          thumbnailUrl,
        });
        const persisted = await commitUploadedTikTokCreatives({
          readItems: () => itemsRef.current,
          writeItems: async (items) => {
            try {
              await persist(items);
            } catch (persistErr) {
              const cause =
                persistErr instanceof Error
                  ? persistErr.message
                  : "Failed to save creatives";
              throw new Error(formatTikTokCreativePersistFailure(cause));
            }
          },
          upload: {
            videoId: result.videoId,
            thumbnailUrl,
            thumbnailExpiresAt: resolveTikTokPreviewExpiry(result.previewUrlExpireAt),
            durationSeconds: result.durationSeconds,
            fileName: file.name,
          },
          baseName,
          adText,
          displayName:
            draft.accountSetup.identityDisplayName ??
            draft.accountSetup.identityManualName ??
            "",
          landingPageUrl: landingPageUrl.trim(),
          cta,
          variationCount: count,
        });
        itemsRef.current = persisted;
        patchJob(jobId, { stage: "done", videoId: result.videoId, thumbnailUrl });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        patchJob(jobId, { stage: "error", error: message });
        setError(message);
      }
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
    const count = clampTikTokVariationCount(variationCount);
    const videoInfo = await loadVideoInfo(videoId);
    if (!videoInfo) return;
    const names = nextTikTokCreativeNames(
      baseName,
      itemsRef.current.length,
      count,
    );
    const displayName =
      draft.accountSetup.identityDisplayName ??
      draft.accountSetup.identityManualName ??
      "";
    const nextItems: TikTokCreativeDraft[] = [
      ...itemsRef.current,
      ...names.map((name) => ({
        id: crypto.randomUUID(),
        name,
        baseName: baseName.trim() || "TikTok creative",
        mode: "VIDEO_REFERENCE" as const,
        videoId,
        videoUrl: videoInput.trim(),
        thumbnailUrl: videoInfo?.thumbnail_url ?? null,
        thumbnailExpiresAt: resolveTikTokPreviewExpiry(
          videoInfo?.preview_url_expire_time,
        ),
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
    try {
      await persist(nextItems);
    } catch {
      // persist already set the operator-facing error
    }
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
    try {
      await persist(itemsRef.current.filter((item) => item.id !== id));
    } catch {
      // persist already set the operator-facing error
    }
  }

  useEffect(() => {
    const advertiserId = draft.accountSetup.advertiserId;
    const expired = itemsRef.current.filter(
      (item) =>
        item.videoId && isTikTokPreviewExpired(item.thumbnailExpiresAt),
    );
    if (!advertiserId || expired.length === 0 || refreshingRef.current) return;
    refreshingRef.current = true;
    let cancelled = false;
    void (async () => {
      const result = await refreshExpiredTikTokThumbnails({
        items: expired,
        fetchInfo: async (videoId) => {
          const videoInfo = await loadVideoInfo(videoId);
          if (!videoInfo?.thumbnail_url) return null;
          return {
            thumbnailUrl: videoInfo.thumbnail_url,
            expiresAt: videoInfo.preview_url_expire_time,
          };
        },
      });
      if (cancelled || result.refetchedIds.length === 0) {
        refreshingRef.current = false;
        return;
      }
      const byId = new Map(result.items.map((item) => [item.id, item]));
      await persist(itemsRef.current.map((item) => byId.get(item.id) ?? item));
      refreshingRef.current = false;
    })();
    return () => {
      cancelled = true;
    };
    // Refetch only when persisted creatives or the advertiser change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.accountSetup.advertiserId, draft.creatives.items]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Creatives</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload a video to the TikTok Asset Library, or paste an existing
          video URL / video_id. Spark Ads are a v2 placeholder and are not
          wired.
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

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void uploadFiles([...event.dataTransfer.files]);
        }}
        className={`relative flex items-center justify-center gap-3 rounded-xl border-2 border-dashed p-5 transition-colors ${
          isDragging
            ? "border-primary bg-primary/10"
            : "border-border bg-muted/30 hover:border-border-strong"
        }`}
      >
        <Upload className={`h-5 w-5 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
        <div className="text-sm">
          <span className={isDragging ? "font-medium text-primary" : "text-muted-foreground"}>
            {isDragging ? "Drop videos to upload" : "Drag & drop videos to upload"}
          </span>
          <span className="text-muted-foreground"> or </span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="font-medium text-primary hover:underline"
          >
            browse
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            .mp4, .mov, .mpeg, .avi · up to 200 MB (Storage ceiling)
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,.mpeg,.avi,video/mp4,video/quicktime,video/mpeg,video/x-msvideo"
          multiple
          className="hidden"
          onChange={(event) => {
            void uploadFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>

      {visibleUploadJobs(uploadJobs, draft.creatives.items).length > 0 && (
        <div className="space-y-2">
          {visibleUploadJobs(uploadJobs, draft.creatives.items).map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-3 rounded-md border border-border bg-background p-3"
            >
              {job.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={job.thumbnailUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-14 w-14 rounded object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                  {job.stage === "done" ? "Ready" : "…"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{job.fileName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {job.sizeLabel} · {jobStageLabel(job)}
                </p>
                {job.videoId && (
                  <p className="truncate text-xs text-muted-foreground">
                    video_id {job.videoId}
                  </p>
                )}
                {job.error && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">{job.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Input
        id="creative-video"
        label="Or paste a TikTok video URL or video_id"
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
        <div>
          <Input
            id="creative-landing-page"
            label="Landing page URL"
            value={landingPageUrl}
            onChange={(event) => setLandingPageUrl(event.target.value)}
            placeholder="https://..."
          />
          <EventPageDestination
            fieldId="tiktok-creative-landing-page-url"
            eventId={draft.eventId}
            value={landingPageUrl}
            onChange={setLandingPageUrl}
          />
        </div>
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
            {item.thumbnailUrl && !isTikTokPreviewExpired(item.thumbnailExpiresAt) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt=""
                referrerPolicy="no-referrer"
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

function visibleUploadJobs(
  jobs: UploadJob[],
  items: TikTokCreativeDraft[],
): UploadJob[] {
  return jobs.filter((job) => {
    if (job.stage !== "done") return true;
    return !items.some((item) => item.videoId && item.videoId === job.videoId);
  });
}

function jobStageLabel(job: UploadJob): string {
  if (job.stage === "storage") return "Uploading to storage…";
  if (job.stage === "tiktok") return "Sending to TikTok Asset Library…";
  if (job.stage === "saving") return "Saving creative to draft…";
  if (job.stage === "done") return "Uploaded";
  return "Failed";
}

function isRateLimitMessage(message: string): boolean {
  return message.includes("50001") || message.toLowerCase().includes("rate");
}

function isVideoNotFoundMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("404") || lower.includes("not found");
}
