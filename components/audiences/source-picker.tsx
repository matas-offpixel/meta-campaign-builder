"use client";

import { useEffect, useMemo, useState } from "react";

import { Select } from "@/components/ui/select";
import type { AudienceSubtype } from "@/lib/types/audience";

export interface SourceSelection {
  sourceId?: string;
  sourceName?: string;
  pageSlug?: string;
  campaignId?: string;
  campaignName?: string;
  videoIds?: string[];
  threshold?: 25 | 50 | 75 | 95 | 100;
  pixelId?: string;
  pixelName?: string;
  pixelEvent?: string;
  useUrlFilter?: boolean;
  urlContains?: string;
}

interface PageSource {
  id: string;
  name: string;
  slug?: string;
  thumbnailUrl?: string;
  instagramBusinessAccount?: {
    id: string;
    username?: string;
    name?: string;
    thumbnailUrl?: string;
  } | null;
}

interface PixelSource {
  id: string;
  name: string;
  lastFiredTime?: string | null;
}

interface CampaignSource {
  id: string;
  name: string;
  effectiveStatus?: string;
  spend: number;
}

interface VideoSource {
  id: string;
  title?: string;
  thumbnailUrl?: string;
  length?: number;
}

export function SourcePicker({
  clientId,
  subtype,
  value,
  onChange,
}: {
  clientId: string;
  subtype: AudienceSubtype;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
}) {
  if (subtype === "video_views") {
    return (
      <VideoSourcePicker clientId={clientId} value={value} onChange={onChange} />
    );
  }
  if (subtype === "website_pixel") {
    return (
      <PixelSourcePicker clientId={clientId} value={value} onChange={onChange} />
    );
  }
  if (subtype.endsWith("_ig")) {
    return <IgSourcePicker clientId={clientId} value={value} onChange={onChange} />;
  }
  return <PageSourcePicker clientId={clientId} value={value} onChange={onChange} />;
}

function PageSourcePicker({
  clientId,
  value,
  onChange,
}: {
  clientId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
}) {
  const { data: pages, loading, error } = useSource<PageSource[]>(
    `/api/audiences/sources/pages?clientId=${clientId}`,
    "pages",
  );
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Facebook Page</p>
      <div className="grid gap-2 md:grid-cols-2">
        {(pages ?? []).map((page) => (
          <button
            key={page.id}
            type="button"
            onClick={() =>
              onChange({
                ...value,
                sourceId: page.id,
                sourceName: page.name,
                pageSlug: page.slug,
              })
            }
            className={`rounded-md border p-3 text-left text-sm ${
              value.sourceId === page.id
                ? "border-primary bg-primary/10"
                : "border-border bg-background"
            }`}
          >
            <SourceAvatar src={page.thumbnailUrl} label={page.name} />
            <p className="mt-2 font-medium">{page.name}</p>
            <p className="text-xs text-muted-foreground">
              {page.slug ? `/${page.slug}` : page.id}
            </p>
          </button>
        ))}
      </div>
      <SourceState loading={loading} error={error} empty={!loading && pages?.length === 0} />
    </div>
  );
}

function IgSourcePicker({
  clientId,
  value,
  onChange,
}: {
  clientId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
}) {
  const { data: pages, loading, error } = useSource<PageSource[]>(
    `/api/audiences/sources/pages?clientId=${clientId}`,
    "pages",
  );
  const accounts = useMemo(() => {
    const seen = new Map<string, NonNullable<PageSource["instagramBusinessAccount"]> & { pageName: string }>();
    for (const page of pages ?? []) {
      const ig = page.instagramBusinessAccount;
      if (ig?.id && !seen.has(ig.id)) seen.set(ig.id, { ...ig, pageName: page.name });
    }
    return Array.from(seen.values());
  }, [pages]);

  return (
    <div className="space-y-2">
      <Select
        id="ig-source"
        label="Instagram account"
        value={value.sourceId ?? ""}
        onChange={(event) => {
          const account = accounts.find((ig) => ig.id === event.target.value);
          onChange({
            ...value,
            sourceId: account?.id ?? "",
            sourceName: account?.username ?? account?.name ?? account?.id,
          });
        }}
        placeholder="Choose IG account"
        options={accounts.map((account) => ({
          value: account.id,
          label: `${account.username ? `@${account.username}` : account.name ?? account.id} · ${account.pageName}`,
        }))}
      />
      <SourceState loading={loading} error={error} empty={!loading && accounts.length === 0} />
    </div>
  );
}

function VideoSourcePicker({
  clientId,
  value,
  onChange,
}: {
  clientId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
}) {
  const { data: campaigns, loading, error } = useSource<CampaignSource[]>(
    `/api/audiences/sources/campaigns?clientId=${clientId}&limit=50`,
    "campaigns",
  );
  const [videos, setVideos] = useState<VideoSource[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    if (!value.campaignId) return;
    let cancelled = false;
    async function loadVideos() {
      setVideoLoading(true);
      setVideoError(null);
      try {
        const res = await fetch(
          `/api/audiences/sources/campaign-videos?clientId=${clientId}&campaignId=${value.campaignId}`,
        );
        const json = (await res.json()) as
          | { ok: true; campaignName: string; videos: VideoSource[] }
          | { error: string };
        if (!res.ok || !("ok" in json)) {
          throw new Error("error" in json ? json.error : "Failed to load videos");
        }
        if (!cancelled) {
          setVideos(json.videos);
          onChange({ ...value, campaignName: json.campaignName });
        }
      } catch (err) {
        if (!cancelled) {
          setVideoError(err instanceof Error ? err.message : "Failed to load videos");
        }
      } finally {
        if (!cancelled) setVideoLoading(false);
      }
    }
    void loadVideos();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, value.campaignId]);

  function toggleVideo(videoId: string) {
    const current = new Set(value.videoIds ?? []);
    if (current.has(videoId)) current.delete(videoId);
    else current.add(videoId);
    onChange({ ...value, videoIds: Array.from(current) });
  }

  return (
    <div className="space-y-3">
      <Select
        id="campaign-source"
        label="Source campaign"
        value={value.campaignId ?? ""}
        onChange={(event) => {
          const campaign = (campaigns ?? []).find((c) => c.id === event.target.value);
          onChange({
            ...value,
            campaignId: campaign?.id ?? "",
            campaignName: campaign?.name,
            videoIds: [],
          });
        }}
        placeholder="Choose campaign"
        options={(campaigns ?? []).map((campaign) => ({
          value: campaign.id,
          label: `${campaign.name} · spend ${campaign.spend.toFixed(2)}`,
        }))}
      />
      <Select
        id="video-threshold"
        label="View threshold"
        value={String(value.threshold ?? 50)}
        onChange={(event) =>
          onChange({
            ...value,
            threshold: Number(event.target.value) as SourceSelection["threshold"],
          })
        }
        options={[25, 50, 75, 95, 100].map((threshold) => ({
          value: String(threshold),
          label: `${threshold}%`,
        }))}
      />
      <div className="grid gap-2 md:grid-cols-3">
        {videos.map((video) => (
          <button
            key={video.id}
            type="button"
            onClick={() => toggleVideo(video.id)}
            className={`rounded-md border p-2 text-left text-xs ${
              value.videoIds?.includes(video.id)
                ? "border-primary bg-primary/10"
                : "border-border bg-background"
            }`}
          >
            {video.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={video.thumbnailUrl}
                alt=""
                className="aspect-video w-full rounded object-cover"
              />
            ) : (
              <div className="aspect-video rounded bg-muted" />
            )}
            <p className="mt-1 line-clamp-2 font-medium">
              {video.title || video.id}
            </p>
          </button>
        ))}
      </div>
      <SourceState
        loading={loading || videoLoading}
        error={error ?? videoError}
        empty={!loading && !videoLoading && Boolean(value.campaignId) && videos.length === 0}
      />
    </div>
  );
}

function PixelSourcePicker({
  clientId,
  value,
  onChange,
}: {
  clientId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
}) {
  const { data: pixels, loading, error } = useSource<PixelSource[]>(
    `/api/audiences/sources/pixels?clientId=${clientId}`,
    "pixels",
  );
  const [customEvent, setCustomEvent] = useState("");
  const eventValue = value.pixelEvent ?? "PageView";
  const isCustom = !PIXEL_EVENTS.includes(eventValue);

  return (
    <div className="space-y-3">
      <Select
        id="pixel-source"
        label="Pixel"
        value={value.pixelId ?? ""}
        onChange={(event) => {
          const pixel = (pixels ?? []).find((p) => p.id === event.target.value);
          onChange({
            ...value,
            pixelId: pixel?.id ?? "",
            pixelName: pixel?.name,
          });
        }}
        placeholder="Choose pixel"
        options={(pixels ?? []).map((pixel) => ({
          value: pixel.id,
          label: `${pixel.name} · ${pixel.id}${pixel.lastFiredTime ? ` · last fired ${pixel.lastFiredTime}` : ""}`,
        }))}
      />
      <Select
        id="pixel-event"
        label="Pixel event"
        value={isCustom ? "__custom" : eventValue}
        onChange={(event) => {
          const next = event.target.value;
          onChange({
            ...value,
            pixelEvent: next === "__custom" ? customEvent : next,
            useUrlFilter:
              next === "ViewContent" ? true : value.useUrlFilter ?? false,
          });
        }}
        options={[
          ...PIXEL_EVENTS.map((eventName) => ({
            value: eventName,
            label: eventName,
          })),
          { value: "__custom", label: "Custom event" },
        ]}
      />
      {isCustom && (
        <TextInput
          id="custom-pixel-event"
          label="Custom event name"
          value={customEvent}
          onChange={(next) => {
            setCustomEvent(next);
            onChange({ ...value, pixelEvent: next });
          }}
        />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value.useUrlFilter)}
          onChange={(event) =>
            onChange({ ...value, useUrlFilter: event.target.checked })
          }
        />
        Site-specific filter
      </label>
      {value.useUrlFilter && (
        <TextInput
          id="url-contains"
          label="URL contains"
          value={value.urlContains ?? ""}
          onChange={(urlContains) => onChange({ ...value, urlContains })}
        />
      )}
      <SourceState loading={loading} error={error} empty={!loading && pixels?.length === 0} />
    </div>
  );
}

function useSource<T>(url: string, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url);
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok) throw new Error(String(json.error ?? "Failed to load source"));
        if (!cancelled) setData(json[key] as T);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load source");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [key, url]);

  return { data, loading, error };
}

function SourceAvatar({ src, label }: { src?: string; label: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-10 w-10 rounded-full object-cover" />;
  }
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-xs font-semibold">
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function SourceState({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
}) {
  if (loading) return <p className="text-xs text-muted-foreground">Loading sources...</p>;
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (empty) return <p className="text-xs text-muted-foreground">No sources found.</p>;
  return null;
}

function TextInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border-strong bg-background px-3 text-sm font-normal text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

const PIXEL_EVENTS = [
  "PageView",
  "ViewContent",
  "InitiateCheckout",
  "Purchase",
  "AddToCart",
];
