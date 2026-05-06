"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { formatCampaignStat } from "@/lib/audiences/format-campaign-spend";
import { filterPagesByQuery } from "@/lib/audiences/filter-pages-by-query";
import { mergeVideoSourcesDeduped } from "@/lib/audiences/merge-video-sources";
import { videoPickerAutoSelectSignature } from "@/lib/audiences/video-picker-auto-select";
import {
  fetchAudienceCampaignVideos,
  fetchAudienceSourceList,
} from "@/lib/audiences/source-picker-fetch";
import type { AudienceSubtype } from "@/lib/types/audience";

export interface SourceSelection {
  sourceId?: string;
  sourceName?: string;
  pageSlug?: string;
  /** Multi-select FB pages (stored as comma sourceId + pageIds in meta). */
  pageIds?: string[];
  pageSummaries?: Array<{ id: string; name: string; slug?: string }>;
  campaignId?: string;
  campaignIds?: string[];
  campaignName?: string;
  campaignSummaries?: Array<{ id: string; name: string }>;
  videoIds?: string[];
  threshold?: 25 | 50 | 75 | 95 | 100;
  pixelId?: string;
  pixelName?: string;
  pixelEvent?: string;
  useUrlFilter?: boolean;
  urlContains?: string | string[];
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
  impressions?: number;
}

interface VideoSource {
  id: string;
  title?: string;
  thumbnailUrl?: string;
  length?: number;
}

interface VideoFetchState {
  videos: VideoSource[];
  loading: boolean;
  error: string | null;
  rateLimited: boolean;
}

function videoTilePrimaryLabel(video: VideoSource): string {
  const title = video.title?.trim();
  // Prefer a meaningful filename (e.g. "0402(3).mp4") over a bare numeric ID.
  if (title && /\.(mp4|mov|webm|m4v)$/i.test(title)) return title;
  if (title && title !== video.id && !/^\d+$/.test(title)) return title;
  return "Untitled video";
}

function VideoAutoSelectOnFetch({
  campaignKey,
  vf,
  value,
  onChange,
}: {
  campaignKey: string;
  vf: VideoFetchState;
  value: SourceSelection;
  onChange: (next: SourceSelection) => void;
}) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const appliedSig = useRef("");

  useEffect(() => {
    appliedSig.current = "";
  }, [campaignKey]);

  useEffect(() => {
    if (!campaignKey || vf.loading || vf.error || vf.videos.length === 0) {
      return;
    }
    const sig = videoPickerAutoSelectSignature(
      campaignKey,
      vf.videos.map((v) => v.id),
    );
    if (appliedSig.current === sig) return;
    appliedSig.current = sig;
    onChange({
      ...latest.current,
      videoIds: vf.videos.map((v) => v.id),
    });
  }, [campaignKey, vf.loading, vf.error, vf.videos, onChange]);

  return null;
}

function CampaignVideoFetcher({
  clientId,
  campaignIds,
  onVideoRateLimitedChange,
  children,
}: {
  clientId: string;
  campaignIds: string[];
  onVideoRateLimitedChange?: (rateLimited: boolean) => void;
  children: (vf: VideoFetchState) => ReactNode;
}) {
  const [vf, setVf] = useState<VideoFetchState>({
    videos: [],
    loading: true,
    error: null,
    rateLimited: false,
  });

  const campaignIdsKey = campaignIds.join(",");

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setVf({
        videos: [],
        loading: true,
        error: null,
        rateLimited: false,
      });
      const results = await Promise.all(
        campaignIds.map((cid) =>
          fetchAudienceCampaignVideos(
            `/api/audiences/sources/campaign-videos?clientId=${clientId}&campaignId=${cid}`,
          ),
        ),
      );
      if (cancelled) return;
      for (const r of results) {
        if (!r.ok) {
          setVf({
            videos: [],
            loading: false,
            error: r.error,
            rateLimited: r.rateLimited,
          });
          return;
        }
      }
      const buckets = results.map((r) => {
        if (!r.ok) return [];
        return r.data.videos;
      });
      const merged = mergeVideoSourcesDeduped(buckets);
      const missingThumbs = merged.filter((v) => !v.thumbnailUrl).length;
      if (
        merged.length > 0 &&
        missingThumbs >= 5 &&
        missingThumbs >= merged.length / 2
      ) {
        console.warn(
          `[Audience video picker] ${missingThumbs}/${merged.length} videos missing Graph \`picture\` — check permissions, video age, or archived ads.`,
        );
      }
      setVf({
        videos: merged,
        loading: false,
        error: null,
        rateLimited: false,
      });
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [clientId, campaignIdsKey, campaignIds]);

  useEffect(() => {
    onVideoRateLimitedChange?.(vf.rateLimited);
  }, [vf.rateLimited, onVideoRateLimitedChange]);

  return <>{children(vf)}</>;
}

export function SourcePicker({
  clientId,
  subtype,
  value,
  onChange,
  sourcePickerInstanceId,
  onRateLimitChange,
}: {
  clientId: string;
  subtype: AudienceSubtype;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
  sourcePickerInstanceId?: string;
  onRateLimitChange?: (instanceId: string, rateLimited: boolean) => void;
}) {
  const instanceId = sourcePickerInstanceId ?? `${clientId}:${subtype}`;

  if (subtype === "video_views") {
    return (
      <VideoSourcePicker
        clientId={clientId}
        instanceId={instanceId}
        value={value}
        onChange={onChange}
        onRateLimitChange={onRateLimitChange}
      />
    );
  }
  if (subtype === "website_pixel") {
    return (
      <PixelSourcePicker
        clientId={clientId}
        instanceId={instanceId}
        value={value}
        onChange={onChange}
        onRateLimitChange={onRateLimitChange}
      />
    );
  }
  if (subtype.endsWith("_ig")) {
    return (
      <IgSourcePicker
        clientId={clientId}
        instanceId={instanceId}
        value={value}
        onChange={onChange}
        onRateLimitChange={onRateLimitChange}
      />
    );
  }
  return (
    <PageSourcePicker
      clientId={clientId}
      instanceId={instanceId}
      value={value}
      onChange={onChange}
      onRateLimitChange={onRateLimitChange}
    />
  );
}

function PageSourcePicker({
  clientId,
  instanceId,
  value,
  onChange,
  onRateLimitChange,
}: {
  clientId: string;
  instanceId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
  onRateLimitChange?: (instanceId: string, rateLimited: boolean) => void;
}) {
  const { data: pages, loading, error, rateLimited } = useSource<PageSource[]>(
    `/api/audiences/sources/pages?clientId=${clientId}`,
    "pages",
    instanceId,
    onRateLimitChange,
  );
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => filterPagesByQuery(pages ?? [], query),
    [pages, query],
  );

  const selectedIds = useMemo(() => {
    if (value.pageIds?.length) return new Set(value.pageIds);
    if (value.sourceId) return new Set([value.sourceId]);
    return new Set<string>();
  }, [value.pageIds, value.sourceId]);

  function togglePage(page: PageSource) {
    const next = new Set(selectedIds);
    if (next.has(page.id)) next.delete(page.id);
    else next.add(page.id);
    const ids = Array.from(next);
    const summaries = ids
      .map((id) => {
        const p = (pages ?? []).find((x) => x.id === id);
        return p
          ? { id: p.id, name: p.name, slug: p.slug }
          : { id, name: id };
      });
    const primary = summaries[0];
    onChange({
      ...value,
      pageIds: ids,
      pageSummaries: summaries,
      sourceId: primary?.id,
      sourceName: primary?.name,
      pageSlug: primary?.slug,
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Facebook Page</p>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Search pages
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or slug…"
          className="h-9 rounded-md border border-border-strong bg-background px-3 text-sm font-normal text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {selectedIds.size} page{selectedIds.size === 1 ? "" : "s"} selected
      </p>
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-2">
        {filtered.map((page) => {
          const checked = selectedIds.has(page.id);
          return (
            <label
              key={page.id}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm ${
                checked ? "border-primary bg-primary/10" : "border-border bg-background"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => togglePage(page)}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <SourceAvatar src={page.thumbnailUrl} label={page.name} />
                  <span className="font-medium">{page.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {page.slug ? `/${page.slug}` : page.id}
                </p>
              </div>
            </label>
          );
        })}
      </div>
      <SourceState
        loading={loading}
        error={error}
        rateLimited={rateLimited}
        empty={!loading && filtered.length === 0}
      />
    </div>
  );
}

function IgSourcePicker({
  clientId,
  instanceId,
  value,
  onChange,
  onRateLimitChange,
}: {
  clientId: string;
  instanceId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
  onRateLimitChange?: (instanceId: string, rateLimited: boolean) => void;
}) {
  const { data: pages, loading, error, rateLimited } = useSource<PageSource[]>(
    `/api/audiences/sources/pages?clientId=${clientId}`,
    "pages",
    instanceId,
    onRateLimitChange,
  );
  const accounts = useMemo(() => {
    const seen = new Map<string, NonNullable<PageSource["instagramBusinessAccount"]> & { pageName: string }>();
    for (const page of pages ?? []) {
      const ig = page.instagramBusinessAccount;
      if (ig?.id && !seen.has(ig.id)) seen.set(ig.id, { ...ig, pageName: page.name });
    }
    return Array.from(seen.values());
  }, [pages]);

  const comboboxOptions: ComboboxOption[] = useMemo(
    () =>
      accounts.map((account) => ({
        value: account.id,
        label: account.username
          ? `@${account.username}`
          : account.name ?? account.id,
        sublabel: `${account.pageName}${account.name && account.name !== account.username ? ` · ${account.name}` : ""}`,
      })),
    [accounts],
  );

  return (
    <div className="space-y-2">
      <Combobox
        label="Instagram account"
        value={value.sourceId ?? ""}
        onChange={(nextId) => {
          const account = accounts.find((ig) => ig.id === nextId);
          onChange({
            ...value,
            sourceId: account?.id ?? "",
            sourceName: account?.username ?? account?.name ?? account?.id,
          });
        }}
        placeholder="Search by handle or page…"
        options={comboboxOptions}
        loading={loading}
        emptyText="No Instagram accounts match"
      />
      <SourceState
        loading={loading}
        error={error}
        rateLimited={rateLimited}
        empty={!loading && accounts.length === 0}
      />
    </div>
  );
}

function VideoSourcePicker({
  clientId,
  instanceId,
  value,
  onChange,
  onRateLimitChange,
}: {
  clientId: string;
  instanceId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
  onRateLimitChange?: (instanceId: string, rateLimited: boolean) => void;
}) {
  const onRateLimitChangeRef = useRef(onRateLimitChange);
  useEffect(() => {
    onRateLimitChangeRef.current = onRateLimitChange;
  }, [onRateLimitChange]);

  const { data: campaigns, loading, error, rateLimited: campaignsRateLimited } =
    useSource<CampaignSource[]>(
      `/api/audiences/sources/campaigns?clientId=${clientId}&limit=200`,
      "campaigns",
      instanceId,
      undefined,
    );

  const [videoRl, setVideoRl] = useState(false);
  const [campaignQuery, setCampaignQuery] = useState("");

  const selectedCampaignIds = useMemo(() => {
    if (value.campaignIds?.length) return value.campaignIds;
    if (value.campaignId) return [value.campaignId];
    return [];
  }, [value.campaignIds, value.campaignId]);

  const campaignKey = selectedCampaignIds.slice().sort().join(",");

  const filteredCampaigns = useMemo(() => {
    const list = campaigns ?? [];
    const q = campaignQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [campaigns, campaignQuery]);

  function toggleCampaign(id: string) {
    const next = new Set(selectedCampaignIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = Array.from(next);
    const summaries = ids.map((cid) => {
      const c = (campaigns ?? []).find((x) => x.id === cid);
      return { id: cid, name: c?.name ?? cid };
    });
    onChange({
      ...value,
      campaignIds: ids,
      campaignId: ids[0],
      campaignSummaries: summaries,
      campaignName: summaries[0]?.name,
      videoIds: [],
    });
  }

  function toggleVideo(videoId: string) {
    const current = new Set(value.videoIds ?? []);
    if (current.has(videoId)) current.delete(videoId);
    else current.add(videoId);
    onChange({ ...value, videoIds: Array.from(current) });
  }

  useEffect(() => {
    const merged =
      campaignsRateLimited || (campaignKey ? videoRl : false);
    onRateLimitChangeRef.current?.(instanceId, merged);
    return () => {
      onRateLimitChangeRef.current?.(instanceId, false);
    };
  }, [campaignsRateLimited, videoRl, campaignKey, instanceId]);

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Search campaigns
        <input
          type="search"
          value={campaignQuery}
          onChange={(e) => setCampaignQuery(e.target.value)}
          placeholder="Filter by name or id…"
          className="h-9 rounded-md border border-border-strong bg-background px-3 text-sm font-normal text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {filteredCampaigns.length} matching · {selectedCampaignIds.length} selected
        </p>
        <div className="flex gap-1.5">
          {filteredCampaigns.length > 0 && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                const allVisibleIds = filteredCampaigns.map((c) => c.id);
                const combined = Array.from(new Set([...selectedCampaignIds, ...allVisibleIds]));
                const summaries = combined.map((cid) => {
                  const c = (campaigns ?? []).find((x) => x.id === cid);
                  return { id: cid, name: c?.name ?? cid };
                });
                onChange({
                  ...value,
                  campaignIds: combined,
                  campaignId: combined[0],
                  campaignSummaries: summaries,
                  campaignName: summaries[0]?.name,
                  videoIds: [],
                });
              }}
            >
              Select all {filteredCampaigns.length} matching
            </button>
          )}
          {selectedCampaignIds.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() =>
                onChange({
                  ...value,
                  campaignIds: [],
                  campaignId: undefined,
                  campaignSummaries: [],
                  campaignName: undefined,
                  videoIds: [],
                })
              }
            >
              Clear {selectedCampaignIds.length} selected
            </button>
          )}
        </div>
      </div>
      <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
        {filteredCampaigns.map((campaign) => {
          const checked = selectedCampaignIds.includes(campaign.id);
          return (
            <label
              key={campaign.id}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm ${
                checked ? "bg-primary/10" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleCampaign(campaign.id)}
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {campaign.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatCampaignStat(campaign.spend, campaign.impressions)}
              </span>
            </label>
          );
        })}
      </div>
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
      {campaignKey ? (
        <CampaignVideoFetcher
          key={campaignKey}
          clientId={clientId}
          campaignIds={selectedCampaignIds}
          onVideoRateLimitedChange={setVideoRl}
        >
          {(vf) => (
            <>
              <VideoAutoSelectOnFetch
                campaignKey={campaignKey}
                vf={vf}
                value={value}
                onChange={onChange}
              />
              {!vf.loading && vf.videos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {vf.videos.length} video{vf.videos.length === 1 ? "" : "s"} from {selectedCampaignIds.length} campaign{selectedCampaignIds.length === 1 ? "" : "s"} ·{" "}
                  {(value.videoIds?.length ?? 0)} selected
                </p>
              )}
              <div className="grid gap-2 md:grid-cols-3">
                {vf.videos.map((video) => (
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
                        alt={videoTilePrimaryLabel(video)}
                        className="aspect-video w-full rounded object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video flex-col items-center justify-center gap-0.5 rounded bg-muted px-1 text-center">
                        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
                          No thumbnail
                        </span>
                        <span className="line-clamp-2 break-all px-1 text-[10px] font-medium text-foreground/70">
                          {videoTilePrimaryLabel(video)}
                        </span>
                      </div>
                    )}
                    <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-tight">
                      {videoTilePrimaryLabel(video)}
                    </p>
                    <p className="truncate font-mono text-[9px] text-muted-foreground/70">
                      {video.id}
                    </p>
                  </button>
                ))}
              </div>
              <SourceState
                loading={loading || vf.loading}
                error={error ?? vf.error}
                rateLimited={campaignsRateLimited || vf.rateLimited}
                empty={
                  !loading &&
                  !vf.loading &&
                  selectedCampaignIds.length > 0 &&
                  vf.videos.length === 0 &&
                  !(error ?? vf.error)
                }
              />
            </>
          )}
        </CampaignVideoFetcher>
      ) : (
        <SourceState
          loading={loading}
          error={error}
          rateLimited={campaignsRateLimited}
          empty={false}
        />
      )}
    </div>
  );
}

function pixelUrlTextareaValue(raw: string | string[] | undefined): string {
  if (raw == null) return "";
  return Array.isArray(raw) ? raw.join("\n") : raw;
}

function PixelSourcePicker({
  clientId,
  instanceId,
  value,
  onChange,
  onRateLimitChange,
}: {
  clientId: string;
  instanceId: string;
  value: SourceSelection;
  onChange: (value: SourceSelection) => void;
  onRateLimitChange?: (instanceId: string, rateLimited: boolean) => void;
}) {
  const { data: pixels, loading, error, rateLimited } = useSource<PixelSource[]>(
    `/api/audiences/sources/pixels?clientId=${clientId}`,
    "pixels",
    instanceId,
    onRateLimitChange,
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
        <label
          htmlFor="url-contains"
          className="flex flex-col gap-1.5 text-sm font-medium"
        >
          URL contains (one per line, OR on Meta)
          <textarea
            id="url-contains"
            rows={4}
            value={pixelUrlTextareaValue(value.urlContains)}
            onChange={(event) => {
              const lines = event.target.value
                .split("\n")
                .map((s) => s.trim());
              const hasAnyContent = lines.some((s) => s.length > 0);
              onChange({
                ...value,
                urlContains: hasAnyContent ? lines : undefined,
              });
            }}
            placeholder="One path fragment per line"
            className="min-h-[88px] resize-y whitespace-pre-wrap rounded-md border border-border-strong bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      )}
      <SourceState
        loading={loading}
        error={error}
        rateLimited={rateLimited}
        empty={!loading && pixels?.length === 0}
      />
    </div>
  );
}

function useSource<T>(
  url: string,
  key: string,
  instanceId: string,
  onRateLimitChange?: (instanceId: string, rateLimited: boolean) => void,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const onRateLimitChangeRef = useRef(onRateLimitChange);
  useEffect(() => {
    onRateLimitChangeRef.current = onRateLimitChange;
  }, [onRateLimitChange]);

  /* eslint-disable react-hooks/set-state-in-effect -- fetch lifecycle when URL changes */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRateLimited(false);

    void fetchAudienceSourceList<T>(url, key).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setRateLimited(result.rateLimited);
        onRateLimitChangeRef.current?.(instanceId, result.rateLimited);
        return;
      }
      setData(result.data);
      onRateLimitChangeRef.current?.(instanceId, false);
    });

    return () => {
      cancelled = true;
      onRateLimitChangeRef.current?.(instanceId, false);
    };
  }, [url, key, instanceId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { data, loading, error, rateLimited };
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
  rateLimited,
  empty,
}: {
  loading: boolean;
  error: string | null;
  rateLimited?: boolean;
  empty: boolean;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading sources...</p>;
  }
  if (error) {
    return (
      <p
        className={`text-xs ${
          rateLimited
            ? "text-amber-800 dark:text-amber-200"
            : "text-destructive"
        }`}
      >
        {error}
      </p>
    );
  }
  if (empty) {
    return <p className="text-xs text-muted-foreground">No sources found.</p>;
  }
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
