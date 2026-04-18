"use client";

import { useState, useCallback, useRef, useMemo, useEffect, useId } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import {
  Plus, Copy, Trash2, ImageIcon, Video, Upload, Play,
  ClipboardCopy, Check, FileText, ShieldOff,
  ChevronDown, ChevronUp,
  AlertCircle, Maximize2, X, RefreshCw, ExternalLink,
  Lock, UserX,
} from "lucide-react";
import type {
  AdCreativeDraft, CTAType, AssetMode, AssetRatio,
  AdSourceType, AssetVariation, Asset, CaptionVariant,
  ExistingPostPlacements,
} from "@/lib/types";
import {
  defaultPlacementsFor,
  resolveExistingPostPlacements,
  validatePlacementSelection,
} from "@/lib/meta/placements";
import { useUploadAsset } from "@/lib/hooks/useUploadAsset";
import { getAspectRatioSlots } from "@/lib/meta/upload";
import { CTA_OPTIONS } from "@/lib/mock-data";
import {
  useFetchPages,
  useFetchInstagramAccounts,
  useFetchPagePosts,
  useFetchInstagramPosts,
  useFetchPageIdentity,
} from "@/lib/hooks/useMeta";
import {
  createDefaultCreative,
  createDefaultAssetVariation,
  createDefaultAsset,
  createDefaultCaption,
} from "@/lib/campaign-defaults";
import { connectFacebookAccount } from "@/lib/facebook-connect";

interface CreativesProps {
  creatives: AdCreativeDraft[];
  onChange: (creatives: AdCreativeDraft[]) => void;
  /** Meta ad account ID — required for real asset uploads */
  adAccountId?: string;
}

const ASSET_MODES: { value: AssetMode; label: string; desc: string }[] = [
  { value: "single", label: "Single", desc: "9:16 Story / Reel" },
  { value: "dual",   label: "Dual",   desc: "4:5 + 9:16" },
  { value: "full",   label: "Full",   desc: "4:5 + 9:16 + 1:1" },
];

const RATIO_LABELS: Record<AssetRatio, { label: string; desc: string }> = {
  "1:1": { label: "1:1", desc: "Square" },
  "4:5": { label: "4:5", desc: "Feed" },
  "9:16": { label: "9:16", desc: "Story / Reel" },
};

type BulkField = "headline" | "description" | "destinationUrl" | "cta";

// ─── Inline loading/error helpers ────────────────────────────────────────────

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
      aria-label="Loading"
    />
  );
}

function FieldStatus({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return (
    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      <Spinner /> Loading…
    </p>
  );
  if (error) return (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <AlertCircle className="h-3 w-3 flex-shrink-0" /> {error}
    </p>
  );
  return null;
}

export function Creatives({ creatives, onChange, adAccountId }: CreativesProps) {
  const [activeId, setActiveId] = useState<string | null>(creatives[0]?.id ?? null);
  const [appliedField, setAppliedField] = useState<BulkField | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkVariationInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [postSearch, setPostSearch] = useState("");
  // Keep a fresh reference for async upload callbacks that run after state updates
  const creativesRef = useRef(creatives);
  useEffect(() => { creativesRef.current = creatives; }, [creatives]);

  // ── Real Meta identity data ────────────────────────────────────────────────
  const pages = useFetchPages();
  const igAccounts = useFetchInstagramAccounts();

  const active = creatives.find((c) => c.id === activeId);

  // Per-page identity (Page access token presence + IG resolution) for the
  // currently selected Page on the active ad. Source of truth for the IG
  // dropdown's "linked / no IG / unresolved" state — `igAccounts` (account-
  // wide) can have false negatives when the system token can't see the page.
  //
  // adAccountId is passed so the server can resolve igActorId from
  // /{adAccountId}/instagram_accounts — the only authoritative ads actor source.
  const activePageIdentity = useFetchPageIdentity(
    active?.identity?.pageId,
    adAccountId,
  );

  const addAd = () => {
    const c = createDefaultCreative();
    c.name = `Ad ${creatives.length + 1}`;
    onChange([...creatives, c]);
    setActiveId(c.id);
  };

  const duplicateAd = (id: string) => {
    const source = creatives.find((c) => c.id === id);
    if (!source) return;
    const copy: AdCreativeDraft = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      identity: { ...(source.identity ?? { pageId: "", instagramAccountId: "" }) },
      assetVariations: (source.assetVariations ?? []).map((v) => ({
        ...v,
        id: crypto.randomUUID(),
        assets: v.assets.map((a) => ({ ...a, id: crypto.randomUUID() })),
      })),
      captions: (source.captions ?? []).map((c) => ({ ...c, id: crypto.randomUUID() })),
      enhancements: { ...(source.enhancements ?? createDefaultCreative().enhancements) },
    };
    onChange([...creatives, copy]);
    setActiveId(copy.id);
  };

  const removeAd = (id: string) => {
    const next = creatives.filter((c) => c.id !== id);
    onChange(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  };

  const updateAd = useCallback(
    (id: string, patch: Partial<AdCreativeDraft>) => {
      onChange(creatives.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [creatives, onChange]
  );

  const handlePageChange = (adId: string, pageId: string) => {
    // Auto-link the Instagram account associated with this page, if we
    // already know one from the account-wide IG accounts list. The
    // per-page identity hook will refine this asynchronously and the
    // sync effect below corrects the selection if a better IG is found.
    const linkedIg = igAccounts.data.find((ig) => ig.linkedPageId === pageId)?.id ?? "";
    updateAd(adId, {
      identity: { pageId, instagramAccountId: linkedIg },
    });
  };

  // When the per-page identity resolves:
  //   1. Backfill instagramAccountId if still empty (content API account).
  //   2. Always update instagramActorId (ads-compatible actor) from the
  //      /{page-id}/instagram_accounts endpoint result — this is the value
  //      that must be sent as instagram_actor_id in creative payloads.
  useEffect(() => {
    if (!active) return;
    const identity = activePageIdentity.data;
    if (!identity || identity.ig.state !== "linked") return;
    if (active.identity?.pageId !== identity.pageId) return;

    const currentContentId = active.identity?.instagramAccountId ?? "";
    const currentActorId   = active.identity?.instagramActorId;
    const resolvedActorId  = identity.ig.account.igActorId;

    // Skip if nothing would change
    if (currentContentId && currentActorId === resolvedActorId) return;

    updateAd(active.id, {
      identity: {
        ...(active.identity ?? { pageId: identity.pageId, instagramAccountId: "" }),
        // Only overwrite content id if it wasn't already set (igAccounts may
        // have populated it before page-identity resolved).
        instagramAccountId: currentContentId || identity.ig.account.id,
        // Always update the actor id — this is the ads-verified ID.
        instagramActorId: resolvedActorId,
      },
    });
  }, [active, activePageIdentity.data, updateAd]);

  // ─── Asset variations ───
  const addAssetVariation = (adId: string) => {
    const ad = creatives.find((c) => c.id === adId);
    if (!ad) return;
    const vars = ad.assetVariations ?? [];
    const ratios = getAspectRatioSlots(ad.mediaType ?? "image", ad.assetMode ?? "dual");
    const v = createDefaultAssetVariation(ratios);
    v.name = `Variation ${vars.length + 1}`;
    updateAd(adId, { assetVariations: [...vars, v] });
  };

  // When asset mode changes, regenerate slots on all variations (preserve already-uploaded assets)
  const handleAssetModeChange = (adId: string, mode: AssetMode) => {
    const ad = creatives.find((c) => c.id === adId);
    if (!ad) return;
    const ratios = getAspectRatioSlots(ad.mediaType ?? "image", mode);
    const updatedVariations = (ad.assetVariations ?? []).map((v) => ({
      ...v,
      assets: ratios.map((ratio) => {
        const existing = v.assets.find((a) => a.aspectRatio === ratio);
        return existing ?? createDefaultAsset(ratio);
      }),
    }));
    updateAd(adId, { assetMode: mode, assetVariations: updatedVariations });
  };

  const removeAssetVariation = (adId: string, varId: string) => {
    const ad = creatives.find((c) => c.id === adId);
    const vars = ad?.assetVariations ?? [];
    if (!ad || vars.length <= 1) return;
    updateAd(adId, { assetVariations: vars.filter((v) => v.id !== varId) });
  };

  const updateAssetVariation = (adId: string, varId: string, patch: Partial<AssetVariation>) => {
    const ad = creatives.find((c) => c.id === adId);
    if (!ad) return;
    updateAd(adId, {
      assetVariations: (ad.assetVariations ?? []).map((v) =>
        v.id === varId ? { ...v, ...patch } : v
      ),
    });
  };

  // ─── Captions ───
  const addCaption = (adId: string) => {
    const ad = creatives.find((c) => c.id === adId);
    if (!ad) return;
    updateAd(adId, { captions: [...(ad.captions ?? []), createDefaultCaption()] });
  };

  const removeCaption = (adId: string, capId: string) => {
    const ad = creatives.find((c) => c.id === adId);
    const caps = ad?.captions ?? [];
    if (!ad || caps.length <= 1) return;
    updateAd(adId, { captions: caps.filter((c) => c.id !== capId) });
  };

  const updateCaption = (adId: string, capId: string, text: string) => {
    const ad = creatives.find((c) => c.id === adId);
    if (!ad) return;
    updateAd(adId, {
      captions: (ad.captions ?? []).map((c) => (c.id === capId ? { ...c, text } : c)),
    });
  };

  // ─── Bulk upload ───
  const handleBulkUpload = (fileCount: number) => {
    const template = active;
    const newAds: AdCreativeDraft[] = [];
    for (let i = 0; i < fileCount; i++) {
      const c = createDefaultCreative();
      c.name = `Ad ${creatives.length + i + 1}`;
      if (template) {
        c.identity = { ...template.identity };
        c.assetMode = template.assetMode ?? "dual";
        c.captions = (template.captions ?? []).map((cap) => ({ ...cap, id: crypto.randomUUID() }));
        c.headline = template.headline;
        c.description = template.description;
        c.destinationUrl = template.destinationUrl;
        c.cta = template.cta;
      }
      const ratios = getAspectRatioSlots(c.mediaType, c.assetMode);
      const variation = createDefaultAssetVariation(ratios);
      variation.name = "Variation 1";
      c.assetVariations = [variation];
      newAds.push(c);
    }
    onChange([...creatives, ...newAds]);
    if (newAds.length > 0) setActiveId(newAds[0].id);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const count = e.dataTransfer.files.length;
    if (count > 0) handleBulkUpload(count);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const count = e.target.files?.length ?? 0;
    if (count > 0) handleBulkUpload(count);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─── Bulk variation upload (one variation per file, within the active ad) ───
  const handleBulkVariationFiles = async (files: FileList) => {
    if (!active || !adAccountId) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Determine media type from first file; validate all are the same
    const firstMediaType = fileArray[0].type.startsWith("video/") ? "video" : "image";
    const allSameType = fileArray.every(
      (f) => (f.type.startsWith("video/") ? "video" : "image") === firstMediaType,
    );
    if (!allSameType) {
      alert("All files must be the same type (all images or all videos).");
      return;
    }

    const ratios = getAspectRatioSlots(active.mediaType ?? "image", active.assetMode ?? "dual");
    const currentVarCount = (active.assetVariations ?? []).length;

    // Build variation stubs — primary slot marked as uploading immediately
    type Entry = { variationId: string; assetId: string; file: File };
    const entries: (Entry & { variation: AssetVariation })[] = fileArray.map((file, i) => {
      const variation = createDefaultAssetVariation(ratios);
      variation.name = `Variation ${currentVarCount + i + 1}`;
      variation.assets[0] = { ...variation.assets[0], uploadStatus: "uploading" };
      return { variationId: variation.id, assetId: variation.assets[0].id, file, variation };
    });

    // Add all stubs to draft at once for instant UI feedback
    onChange(
      creativesRef.current.map((c) =>
        c.id === active.id
          ? { ...c, assetVariations: [...(c.assetVariations ?? []), ...entries.map((e) => e.variation)] }
          : c,
      ),
    );

    // Upload sequentially; update each slot after its upload resolves
    for (const entry of entries) {
      try {
        const fd = new FormData();
        fd.append("file", entry.file);
        fd.append("type", firstMediaType);
        fd.append("adAccountId", adAccountId);
        const res = await fetch("/api/meta/upload-asset", { method: "POST", body: fd });
        const json = (await res.json()) as Record<string, unknown>;

        const patch: Partial<Asset> = res.ok
          ? {
              uploadedUrl: json.url as string,
              thumbnailUrl: (json.previewUrl ?? json.url) as string,
              assetHash: json.hash as string | undefined,
              videoId: json.videoId as string | undefined,
              uploadStatus: "uploaded",
            }
          : {
              uploadStatus: "error",
              error: (json.error as string) ?? `HTTP ${res.status}`,
            };

        onChange(
          creativesRef.current.map((c) => {
            if (c.id !== active.id) return c;
            return {
              ...c,
              assetVariations: (c.assetVariations ?? []).map((v) =>
                v.id !== entry.variationId
                  ? v
                  : {
                      ...v,
                      assets: v.assets.map((a) =>
                        a.id === entry.assetId ? { ...a, ...patch } : a,
                      ),
                    },
              ),
            };
          }),
        );
      } catch {
        onChange(
          creativesRef.current.map((c) => {
            if (c.id !== active.id) return c;
            return {
              ...c,
              assetVariations: (c.assetVariations ?? []).map((v) =>
                v.id !== entry.variationId
                  ? v
                  : {
                      ...v,
                      assets: v.assets.map((a) =>
                        a.id === entry.assetId
                          ? { ...a, uploadStatus: "error", error: "Network error" }
                          : a,
                      ),
                    },
              ),
            };
          }),
        );
      }
    }
  };

  // ─── Bulk apply ───
  const applyToAll = (field: BulkField) => {
    if (!active) return;
    const value = active[field];
    const updated = creatives.map((c) => {
      if (field === "cta") return { ...c, cta: value as CTAType };
      return { ...c, [field]: value };
    });
    onChange(updated);
    setAppliedField(field);
    setTimeout(() => setAppliedField(null), 1500);
  };

  const applyCaptionsToAll = () => {
    if (!active) return;
    const caps = (active.captions ?? []).map((c) => ({ ...c, id: crypto.randomUUID() }));
    const updated = creatives.map((c) =>
      c.id === active.id ? c : { ...c, captions: caps.map((cap) => ({ ...cap, id: crypto.randomUUID() })) }
    );
    onChange(updated);
    setAppliedField("headline" as BulkField); // reuse for flash
    setTimeout(() => setAppliedField(null), 1500);
  };

  // ─── Existing post picker ───
  // Only kick off network requests when the user is actually inside the
  // existing-post mode AND a page is selected. Switching back to "Create New"
  // disables both hooks (status → idle, in-flight requests aborted).
  const isExistingPostMode = (active?.sourceType ?? "new") === "existing_post";
  // Default source = Instagram per spec. The user toggles via the source
  // selector; selection is persisted on the creative once they pick a post.
  const existingPostSource: "instagram" | "facebook" =
    active?.existingPost?.source ?? "instagram";
  const igUserId = active?.identity?.instagramAccountId || undefined;

  const fbExistingEnabled =
    isExistingPostMode &&
    existingPostSource === "facebook" &&
    Boolean(active?.identity?.pageId);
  const igExistingEnabled =
    isExistingPostMode &&
    existingPostSource === "instagram" &&
    Boolean(igUserId);

  const pagePosts = useFetchPagePosts(active?.identity?.pageId, {
    enabled: fbExistingEnabled,
  });
  const igPosts = useFetchInstagramPosts(igUserId, {
    enabled: igExistingEnabled,
    pageId: active?.identity?.pageId,
  });

  const filteredPosts = useMemo(() => {
    if (!postSearch) return pagePosts.data;
    const q = postSearch.toLowerCase();
    return pagePosts.data.filter((p) => p.message.toLowerCase().includes(q));
  }, [pagePosts.data, postSearch]);

  const filteredIgPosts = useMemo(() => {
    if (!postSearch) return igPosts.data;
    const q = postSearch.toLowerCase();
    return igPosts.data.filter((p) => p.caption.toLowerCase().includes(q));
  }, [igPosts.data, postSearch]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl tracking-wide">Creatives</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Build ads with page identity, assets, and copy.{" "}
            <span className="font-medium text-foreground">{creatives.length} ad{creatives.length !== 1 ? "s" : ""}</span>
          </p>
        </div>
        <Button size="sm" onClick={addAd}>
          <Plus className="h-3.5 w-3.5" />
          Add Ad
        </Button>
      </div>

      {/* Bulk upload drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`relative flex items-center justify-center gap-3 rounded-xl border-2 border-dashed p-5 transition-colors
          ${isDragging ? "border-primary bg-primary-light" : "border-border bg-muted/30 hover:border-border-strong"}`}
      >
        <Upload className={`h-5 w-5 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
        <div className="text-sm">
          <span className={isDragging ? "text-primary font-medium" : "text-muted-foreground"}>
            {isDragging ? "Drop files to create ads" : "Drag & drop files to bulk-create ads"}
          </span>
          <span className="text-muted-foreground"> or </span>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="font-medium text-primary hover:underline">
            browse
          </button>
        </div>
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileInput} />
      </div>

      {creatives.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-muted-foreground">No ads yet. Add your first ad or drag files above.</p>
          <Button size="sm" className="mt-3" onClick={addAd}>
            <Plus className="h-3.5 w-3.5" />
            Add Ad
          </Button>
        </Card>
      ) : (
        <div className="flex gap-5">
          {/* ─── Sidebar ─── */}
          <div className="w-56 shrink-0 space-y-1">
            <div className="mb-2 px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ads ({creatives.length})</span>
            </div>
            <div className="max-h-[560px] space-y-1 overflow-y-auto">
              {creatives.map((c, i) => {
                const page = pages.data.find((p) => p.id === c.identity?.pageId);
                const isActive = activeId === c.id;
                const varCount = (c.assetVariations ?? []).length;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className={`group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors
                      ${isActive ? "border-primary bg-primary-light" : "border-border hover:bg-muted"}`}
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name || `Ad ${i + 1}`}</span>
                      {page && <span className="block truncate text-[11px] text-muted-foreground">{page.name}</span>}
                      <div className="mt-0.5 flex gap-1">
                        <Badge variant={(c.sourceType ?? "new") === "existing_post" ? "warning" : "outline"} className="text-[8px] px-1 py-0">
                          {(c.sourceType ?? "new") === "existing_post" ? "post" : "new"}
                        </Badge>
                        {(c.sourceType ?? "new") === "new" && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0">{varCount} var</Badge>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── Editor panel ─── */}
          {active && (
            <div className="flex-1 space-y-4">
              {/* Header bar */}
              <Card>
                <div className="flex items-center justify-between">
                  <CardTitle>{active.name || "Untitled Ad"}</CardTitle>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => duplicateAd(active.id)} title="Duplicate">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeAd(active.id)} title="Delete" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {/* Ad name */}
                  <Input
                    label="Ad Name"
                    value={active.name}
                    onChange={(e) => updateAd(active.id, { name: e.target.value })}
                    placeholder="e.g. J2 — Artist Artwork A"
                  />

                  {/* Source type */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Ad Source</label>
                    <div className="flex gap-2">
                      {([
                        { value: "new" as AdSourceType, label: "Create New Ad", icon: ImageIcon },
                        { value: "existing_post" as AdSourceType, label: "Use Existing Post", icon: FileText },
                      ]).map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateAd(active.id, { sourceType: value })}
                          className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors
                            ${(active.sourceType ?? "new") === value ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Identity: Page + IG */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Select
                        label="Facebook Page"
                        value={active.identity?.pageId ?? ""}
                        onChange={(e) => handlePageChange(active.id, e.target.value)}
                        placeholder={
                          pages.loading ? "Loading pages…" : "Select page…"
                        }
                        disabled={pages.loading}
                        options={[
                          { value: "", label: "— Select page —" },
                          ...pages.data.map((p) => ({ value: p.id, label: p.name })),
                        ]}
                      />
                      <FieldStatus loading={pages.loading} error={pages.error} />
                    </div>
                    <div>
                      {/* IG dropdown — three sources merged in priority order:
                            1. Per-page identity (authoritative; uses user OAuth
                               token, can see pages the system token can't).
                            2. Account-wide IG accounts cache (filtered to the
                               selected page) — fills in while identity loads.
                            3. Empty list when neither has data yet. */}
                      {(() => {
                        const selectedPageId = active.identity?.pageId;
                        const identityState = activePageIdentity;
                        const identityIg =
                          identityState.data?.ig.state === "linked"
                            ? identityState.data.ig.account
                            : null;
                        const cacheIg = selectedPageId
                          ? igAccounts.data.filter(
                              (ig) => ig.linkedPageId === selectedPageId,
                            )
                          : [];
                        const mergedIG = identityIg
                          ? [
                              {
                                id: identityIg.id,
                                username: identityIg.username,
                                name: identityIg.name,
                              },
                              ...cacheIg.filter((ig) => ig.id !== identityIg.id),
                            ]
                          : cacheIg;

                        const identityLoading = identityState.status === "loading";
                        const identityError =
                          identityState.status === "error"
                            ? identityState.error
                            : null;
                        const igDefinitivelyAbsent =
                          identityState.data?.ig.state === "no_ig" &&
                          mergedIG.length === 0;
                        const igUnresolved =
                          identityState.data?.ig.state === "unresolved" &&
                          mergedIG.length === 0;

                        return (
                          <>
                            <Select
                              label="Instagram Account"
                              value={active.identity?.instagramAccountId ?? ""}
                              onChange={(e) =>
                                updateAd(active.id, {
                                  identity: {
                                    ...(active.identity ?? { pageId: "", instagramAccountId: "" }),
                                    instagramAccountId: e.target.value,
                                  },
                                })
                              }
                              placeholder={
                                igAccounts.loading || identityLoading
                                  ? "Loading…"
                                  : !selectedPageId
                                    ? "Select a page first…"
                                    : "Select account…"
                              }
                              disabled={
                                (igAccounts.loading && identityLoading) ||
                                !selectedPageId
                              }
                              options={[
                                { value: "", label: "— None —" },
                                ...mergedIG.map((ig) => ({
                                  value: ig.id,
                                  label: ig.username
                                    ? `@${ig.username}`
                                    : (ig.name ?? ig.id),
                                })),
                              ]}
                            />
                            <FieldStatus
                              loading={igAccounts.loading || identityLoading}
                              error={igAccounts.error ?? identityError}
                            />
                            {/* Definitive: page exists, no IG linked. */}
                            {selectedPageId && igDefinitivelyAbsent && (
                              <p className="mt-1 text-[11px] text-warning">
                                No linked Instagram account found for this page. Ads will use the Facebook Page identity only.
                              </p>
                            )}
                            {/* Soft: lookup failed, do NOT claim the page has no IG. */}
                            {selectedPageId && igUnresolved && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Couldn&rsquo;t verify Instagram linkage for this page
                                {identityState.data?.ig.state === "unresolved" &&
                                identityState.data.ig.reason
                                  ? ` (${identityState.data.ig.reason})`
                                  : ""}
                                . Reconnect Facebook if this is unexpected.
                              </p>
                            )}
                            {/* Resolved + linked — surface where it came from for debugging. */}
                            {identityIg && (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                Linked via{" "}
                                {identityState.data?.ig.state === "linked"
                                  ? identityState.data.ig.account.source ===
                                    "instagram_business_account"
                                    ? "Instagram Business Account"
                                    : "Connected Instagram Account"
                                  : "—"}
                                .
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </Card>

              {/* ═══ NEW AD MODE ═══ */}
              {(active.sourceType ?? "new") === "new" && (
                <>
                  {/* Media type + asset mode */}
                  <Card>
                    <div className="space-y-4">
                      <div className="flex items-center gap-6">
                        <div>
                          <label className="mb-1.5 block text-sm font-medium">Media Type</label>
                          <div className="flex gap-2">
                            {(["image", "video"] as const).map((type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => updateAd(active.id, { mediaType: type })}
                                className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors
                                  ${active.mediaType === type ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
                              >
                                {type === "video" ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                                {type.charAt(0).toUpperCase() + type.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-sm font-medium">Asset Mode</label>
                          <div className="flex gap-1.5">
                            {ASSET_MODES.map((mode) => (
                              <button
                                key={mode.value}
                                type="button"
                                onClick={() => handleAssetModeChange(active.id, mode.value)}
                                className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors
                                  ${(active.assetMode ?? "dual") === mode.value ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
                              >
                                {mode.label} <span className="opacity-70">({mode.desc})</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* ─── Asset variations ─── */}
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <label className="text-sm font-medium">
                            Asset Variations ({(active.assetVariations ?? []).length})
                          </label>
                          <div className="flex items-center gap-2">
                            {adAccountId && (
                              <>
                                <input
                                  ref={bulkVariationInputRef}
                                  type="file"
                                  multiple
                                  accept="image/jpeg,image/png,video/mp4"
                                  className="hidden"
                                  onChange={(e) => {
                                    if (e.target.files && e.target.files.length > 0) {
                                      void handleBulkVariationFiles(e.target.files);
                                    }
                                    e.target.value = "";
                                  }}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => bulkVariationInputRef.current?.click()}
                                  title="Upload multiple files — one variation per file"
                                >
                                  <Upload className="h-3 w-3" /> Bulk Upload
                                </Button>
                              </>
                            )}
                            <Button variant="outline" size="sm" onClick={() => addAssetVariation(active.id)}>
                              <Plus className="h-3 w-3" /> Add Variation
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {(active.assetVariations ?? []).map((variation, vi) => (
                            <AssetVariationCard
                              key={variation.id}
                              variation={variation}
                              index={vi}
                              mediaType={active.mediaType ?? "image"}
                              adAccountId={adAccountId}
                              canRemove={(active.assetVariations ?? []).length > 1}
                              onUpdate={(patch) => updateAssetVariation(active.id, variation.id, patch)}
                              onRemove={() => removeAssetVariation(active.id, variation.id)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* ─── Captions + Copy ─── */}
                  <Card>
                    <div className="space-y-4">
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-sm font-medium">Primary Text / Captions ({(active.captions ?? []).length})</label>
                        <Button variant="outline" size="sm" onClick={() => addCaption(active.id)}>
                          <Plus className="h-3 w-3" /> Add Caption
                        </Button>
                      </div>
                      {(active.captions ?? []).map((cap, ci) => (
                        <div key={cap.id} className="flex gap-2">
                          <div className="flex-1">
                            <textarea
                              value={cap.text}
                              onChange={(e) => updateCaption(active.id, cap.id, e.target.value)}
                              placeholder={`Caption ${ci + 1}...`}
                              className="w-full resize-none rounded-lg border border-border bg-card p-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                              rows={2}
                            />
                          </div>
                          {(active.captions ?? []).length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeCaption(active.id, cap.id)}
                              className="mt-2 rounded p-1 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}

                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="Headline"
                          value={active.headline}
                          onChange={(e) => updateAd(active.id, { headline: e.target.value })}
                          placeholder="Event headline"
                        />
                        <Input
                          label="Description"
                          value={active.description}
                          onChange={(e) => updateAd(active.id, { description: e.target.value })}
                          placeholder="Short description"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="Destination URL"
                          value={active.destinationUrl}
                          onChange={(e) => updateAd(active.id, { destinationUrl: e.target.value })}
                          placeholder="https://..."
                        />
                        <Select
                          label="Call to Action"
                          value={active.cta}
                          onChange={(e) => updateAd(active.id, { cta: e.target.value as CTAType })}
                          options={CTA_OPTIONS}
                        />
                      </div>
                    </div>
                  </Card>
                </>
              )}

              {/* ═══ EXISTING POST MODE ═══ */}
              {(active.sourceType ?? "new") === "existing_post" && (
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>Select Existing Post</CardTitle>
                      <CardDescription>
                        {existingPostSource === "instagram"
                          ? igUserId
                            ? "Choose a published post from the linked Instagram account."
                            : "No linked Instagram account on the selected Page — switch to Facebook below or pick a Page with a connected IG account."
                          : active.identity?.pageId
                            ? "Choose a published post from the selected Facebook Page's feed."
                            : "Select a Facebook Page above to see available posts."}
                      </CardDescription>
                    </div>
                    {/* Source toggle — Instagram (default) | Facebook */}
                    <div
                      role="tablist"
                      aria-label="Existing post source"
                      className="inline-flex shrink-0 rounded-md border border-border bg-muted/30 p-0.5 text-xs"
                    >
                      {(["instagram", "facebook"] as const).map((src) => {
                        const isActive = existingPostSource === src;
                        const label = src === "instagram" ? "Instagram" : "Facebook";
                        return (
                          <button
                            key={src}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => {
                              setPostSearch("");
                              updateAd(active.id, {
                                existingPost: {
                                  source: src,
                                  postId: "",
                                  postPreview: undefined,
                                  instagramAccountId:
                                    src === "instagram" ? igUserId : undefined,
                                },
                              });
                            }}
                            className={`rounded px-2.5 py-1 font-medium transition-colors
                              ${isActive
                                ? "bg-foreground text-background"
                                : "text-muted-foreground hover:text-foreground"}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Instagram branch ──────────────────────────────────── */}
                  {existingPostSource === "instagram" && (
                    <div className="mt-4 space-y-3">
                      {igPosts.status === "idle" && (
                        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                          {igUserId
                            ? "Loading Instagram posts…"
                            : "No linked Instagram account — pick a Page with an IG business account, or switch to the Facebook tab."}
                        </div>
                      )}
                      {igPosts.status === "loading" && (
                        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                          <Spinner /> Loading Instagram posts…
                        </div>
                      )}
                      {igPosts.status === "error" && (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
                          <div className="flex items-start gap-2 text-destructive">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <div className="flex-1">
                              <p className="font-medium">
                                Couldn&rsquo;t load Instagram posts.
                              </p>
                              {igPosts.error && (
                                <p className="mt-0.5 text-xs opacity-80">{igPosts.error}</p>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 flex justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => igPosts.refetch()}
                            >
                              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Try again
                            </Button>
                          </div>
                        </div>
                      )}
                      {igPosts.status === "permission_denied" && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                          <div className="flex items-start gap-2">
                            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                            <div className="flex-1">
                              <p className="font-medium">
                                Instagram account linked, but this app session
                                doesn&rsquo;t have permission to read its posts.
                              </p>
                              <p className="mt-1 text-xs opacity-90">
                                Reconnect Facebook/Instagram and grant access to
                                Instagram content to use this account&rsquo;s posts.
                              </p>
                              {igPosts.missingScopes && igPosts.missingScopes.length > 0 && (
                                <p className="mt-1 font-mono text-[11px] opacity-70">
                                  Missing: {igPosts.missingScopes.join(", ")}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => igPosts.refetch()}
                            >
                              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                // Triggers the same OAuth flow used in account
                                // setup; lands the user back on this campaign.
                                const returnPath =
                                  typeof window !== "undefined"
                                    ? window.location.pathname
                                    : "/";
                                void connectFacebookAccount({ returnPath });
                              }}
                            >
                              Reconnect Facebook
                            </Button>
                          </div>
                        </div>
                      )}
                      {igPosts.status === "account_personal" && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                          <div className="flex items-start gap-2">
                            <UserX className="mt-0.5 h-4 w-4 shrink-0" />
                            <div className="flex-1">
                              <p className="font-medium">
                                The linked Instagram account is a Personal account.
                              </p>
                              <p className="mt-1 text-xs opacity-90">
                                The Instagram Graph API only returns posts for
                                Business or Creator accounts. Convert the account
                                in the Instagram app, then reconnect Facebook —
                                or switch to the Facebook tab to use a Page post.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      {igPosts.status === "empty" && (
                        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                          <p>No published Instagram posts found.</p>
                          <p className="mt-1 text-xs">
                            Publish a post on the IG account first, or switch to Facebook.
                          </p>
                        </div>
                      )}
                      {igPosts.status === "success" && (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <SearchInput
                                value={postSearch}
                                onChange={(e) => setPostSearch(e.target.value)}
                                onClear={() => setPostSearch("")}
                                placeholder="Search captions..."
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => igPosts.refetch()}
                              title="Reload IG posts"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="max-h-80 space-y-2 overflow-y-auto">
                            {filteredIgPosts.length === 0 ? (
                              <p className="py-4 text-center text-sm text-muted-foreground">
                                No posts match &ldquo;{postSearch}&rdquo;.
                              </p>
                            ) : (
                              filteredIgPosts.map((post) => {
                                const isSelected =
                                  active.existingPost?.source === "instagram" &&
                                  active.existingPost?.postId === post.id;
                                const previewSrc =
                                  post.thumbnailUrl || post.mediaUrl;
                                return (
                                  <button
                                    key={post.id}
                                    type="button"
                                    onClick={() =>
                                      updateAd(active.id, {
                                        existingPost: {
                                          source: "instagram",
                                          postId: post.id,
                                          postPreview: post.caption,
                                          instagramAccountId: post.igUserId,
                                        },
                                      })
                                    }
                                    className={`group w-full rounded-lg border p-3 text-left transition-colors
                                      ${isSelected
                                        ? "border-primary bg-primary-light"
                                        : "border-border hover:bg-muted/50"}`}
                                  >
                                    <div className="flex items-start gap-3">
                                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                                        {previewSrc ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={previewSrc}
                                            alt=""
                                            className="h-full w-full object-cover"
                                          />
                                        ) : post.mediaType === "video" ? (
                                          <Video className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="line-clamp-2 text-sm">{post.caption}</p>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                          <span>
                                            {new Date(post.timestamp).toLocaleDateString()}
                                          </span>
                                          <Badge variant="outline" className="text-[10px]">
                                            {post.mediaType}
                                          </Badge>
                                          {post.permalink && (
                                            <a
                                              href={post.permalink}
                                              target="_blank"
                                              rel="noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="inline-flex items-center gap-0.5 hover:text-foreground"
                                            >
                                              View on Instagram <ExternalLink className="h-3 w-3" />
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                      {isSelected && <Badge variant="primary">Selected</Badge>}
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
                            <Input
                              label="Destination URL (optional)"
                              value={active.destinationUrl}
                              onChange={(e) => updateAd(active.id, { destinationUrl: e.target.value })}
                              placeholder="https://..."
                            />
                            <Select
                              label="CTA (optional)"
                              value={active.cta}
                              onChange={(e) => updateAd(active.id, { cta: e.target.value as CTAType })}
                              options={CTA_OPTIONS}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* ── Facebook branch ───────────────────────────────────── */}
                  {existingPostSource === "facebook" && (
                  <div className="mt-4 space-y-3">
                    {/* idle — no page selected yet */}
                    {pagePosts.status === "idle" && (
                      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                        Pick a Facebook Page above to load its recent posts.
                      </div>
                    )}

                    {/* loading */}
                    {pagePosts.status === "loading" && (
                      <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                        <Spinner /> Loading posts…
                      </div>
                    )}

                    {/* error — with retry */}
                    {pagePosts.status === "error" && (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
                        <div className="flex items-start gap-2 text-destructive">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <div className="flex-1">
                            <p className="font-medium">Couldn&rsquo;t load posts for this page.</p>
                            {pagePosts.error && (
                              <p className="mt-0.5 text-xs opacity-80">{pagePosts.error}</p>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => pagePosts.refetch()}
                          >
                            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Try again
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* empty */}
                    {pagePosts.status === "empty" && (
                      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                        <p>No eligible published posts found for this page.</p>
                        <p className="mt-1 text-xs">
                          Publish a post on the Page first, or pick a different Page.
                        </p>
                      </div>
                    )}

                    {/* success — search + list */}
                    {pagePosts.status === "success" && (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <SearchInput
                              value={postSearch}
                              onChange={(e) => setPostSearch(e.target.value)}
                              onClear={() => setPostSearch("")}
                              placeholder="Search posts..."
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => pagePosts.refetch()}
                            title="Reload posts"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        <div className="max-h-80 space-y-2 overflow-y-auto">
                          {filteredPosts.length === 0 ? (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                              No posts match &ldquo;{postSearch}&rdquo;.
                            </p>
                          ) : (
                            filteredPosts.map((post) => {
                              const isSelected = active.existingPost?.postId === post.id;
                              const ineligible = post.eligibleForPromotion === false;
                              return (
                                <button
                                  key={post.id}
                                  type="button"
                                  onClick={() => updateAd(active.id, {
                                    existingPost: { postId: post.id, postPreview: post.message },
                                  })}
                                  className={`group w-full rounded-lg border p-3 text-left transition-colors
                                    ${isSelected
                                      ? "border-primary bg-primary-light"
                                      : "border-border hover:bg-muted/50"}`}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                                      {post.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={post.imageUrl}
                                          alt=""
                                          className="h-full w-full object-cover"
                                        />
                                      ) : post.type === "video" ? (
                                        <Video className="h-4 w-4 text-muted-foreground" />
                                      ) : post.type === "link" ? (
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                      ) : (
                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="line-clamp-2 text-sm">{post.message}</p>
                                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                        <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                                        {post.permalinkUrl && (
                                          <a
                                            href={post.permalinkUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="inline-flex items-center gap-0.5 hover:text-foreground"
                                          >
                                            View on Facebook <ExternalLink className="h-3 w-3" />
                                          </a>
                                        )}
                                        {ineligible && (
                                          <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                                            Not eligible to promote
                                          </Badge>
                                        )}
                                      </div>
                                      {ineligible && post.ineligibleReason && (
                                        <p className="mt-1 text-[11px] text-amber-700/80">
                                          {post.ineligibleReason}
                                        </p>
                                      )}
                                    </div>
                                    {isSelected && <Badge variant="primary">Selected</Badge>}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>

                        {/* Optional CTA/URL override for existing posts — preserved from prior UI */}
                        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
                          <Input
                            label="Destination URL (optional)"
                            value={active.destinationUrl}
                            onChange={(e) => updateAd(active.id, { destinationUrl: e.target.value })}
                            placeholder="https://..."
                          />
                          <Select
                            label="CTA (optional)"
                            value={active.cta}
                            onChange={(e) => updateAd(active.id, { cta: e.target.value as CTAType })}
                            options={CTA_OPTIONS}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  )}

                  {/* ── Placement controls ────────────────────────────────── */}
                  {active.existingPost?.postId && (() => {
                    const src = active.existingPost?.source ?? "instagram";
                    const current = resolveExistingPostPlacements(active.existingPost);
                    const validation = validatePlacementSelection(current, src);

                    const toggle = (key: keyof ExistingPostPlacements, val: boolean) => {
                      updateAd(active.id, {
                        existingPost: {
                          ...(active.existingPost ?? { postId: "", source: src }),
                          placements: { ...current, [key]: val },
                        },
                      });
                    };

                    type PlacementRow = {
                      key: keyof ExistingPostPlacements;
                      label: string;
                    };
                    const igRows: PlacementRow[] = [
                      { key: "igFeed",    label: "Feed"    },
                      { key: "igStories", label: "Stories" },
                      { key: "igReels",   label: "Reels"   },
                    ];
                    const fbRows: PlacementRow[] = [
                      { key: "fbFeed",  label: "Feed"  },
                      { key: "fbReels", label: "Reels" },
                    ];

                    return (
                      <div className="mt-4 border-t border-border pt-4 space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Placements
                        </p>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Instagram */}
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-foreground">Instagram</p>
                            {igRows.map(({ key, label }) => (
                              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={current[key]}
                                  onChange={(e) => toggle(key, e.target.checked)}
                                  className="h-3.5 w-3.5 rounded accent-primary"
                                />
                                {label}
                              </label>
                            ))}
                          </div>

                          {/* Facebook */}
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-foreground">Facebook</p>
                            {fbRows.map(({ key, label }) => (
                              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={current[key]}
                                  onChange={(e) => toggle(key, e.target.checked)}
                                  className="h-3.5 w-3.5 rounded accent-primary"
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Validation errors */}
                        {validation.errors.map((err) => (
                          <div
                            key={err}
                            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                          >
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {err}
                          </div>
                        ))}

                        {/* Soft warnings (stories/reels crop warning) — only show
                            the crop warning; suppress the "cross-posting" noise */}
                        {validation.warnings
                          .filter((w) => w.includes("crop"))
                          .map((w) => (
                            <p key={w} className="text-[11px] text-amber-700/90">
                              ⚠ {w}
                            </p>
                          ))}
                      </div>
                    );
                  })()}
                </Card>
              )}

              {/* ─── Enhancements (always off) ─── */}
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Creative Enhancements</span>
                  <Badge variant="outline" className="text-[10px]">All OFF</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Text optimizations, visual enhancements, music, and auto-variations are disabled. Ads will publish exactly as configured.
                </p>
              </div>

              {/* ─── Bulk apply ─── */}
              {creatives.length > 1 && (
                <Card>
                  <CardTitle>Apply to All Ads</CardTitle>
                  <CardDescription>Copy a field from this ad to every other ad.</CardDescription>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {([
                      { field: "headline" as BulkField, label: "Headline" },
                      { field: "description" as BulkField, label: "Description" },
                      { field: "destinationUrl" as BulkField, label: "URL" },
                      { field: "cta" as BulkField, label: "CTA" },
                    ]).map(({ field, label }) => {
                      const justApplied = appliedField === field;
                      return (
                        <Button
                          key={field}
                          variant={justApplied ? "primary" : "outline"}
                          size="sm"
                          onClick={() => applyToAll(field)}
                          disabled={justApplied}
                        >
                          {justApplied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                          {justApplied ? `Applied` : `Copy ${label}`}
                        </Button>
                      );
                    })}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={applyCaptionsToAll}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" /> Copy Captions
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Asset Variation Sub-component ───

// CSS aspect-ratio class per slot ratio
const SLOT_ASPECT: Record<string, string> = {
  "1:1":  "aspect-square",
  "4:5":  "aspect-[4/5]",
  "9:16": "aspect-[9/16]",
};

// Module-level registry: maps asset.id → local blob URL.
// Lives outside the component so blob URLs survive React remounts when the
// user switches between ads. Only revoked when the asset is explicitly removed
// or replaced, never on component unmount.
const blobUrlRegistry = new Map<string, string>();

// ─── Single asset upload slot ─────────────────────────────────────────────────

function AssetSlot({
  asset,
  mediaType,
  adAccountId,
  onUpdate,
}: {
  asset: Asset;
  mediaType: "image" | "video";
  adAccountId?: string;
  onUpdate: (patch: Partial<Asset>) => void;
}) {
  const { mutate: upload } = useUploadAsset();
  const inputId = useId();
  const [isDragOver, setIsDragOver] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Initialise from registry so video previews persist when the user
  // switches to another ad and back (component unmounts / remounts).
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(
    () => blobUrlRegistry.get(asset.id) ?? null,
  );

  const ratioInfo = RATIO_LABELS[asset.aspectRatio];
  const aspectClass = SLOT_ASPECT[asset.aspectRatio] ?? "aspect-[4/5]";

  const accept = mediaType === "video"
    ? "video/mp4,video/quicktime,video/*"
    : "image/jpeg,image/png";

  const isUploading = asset.uploadStatus === "uploading";
  const isUploaded  = asset.uploadStatus === "uploaded";
  const isError     = asset.uploadStatus === "error";
  const isVideo     = mediaType === "video";

  async function handleFile(file: File) {
    if (!adAccountId || isUploading) return;

    // For video files create a local blob preview immediately so the slot
    // renders a real video frame before (and even if) Meta returns a thumbnail.
    if (file.type.startsWith("video/")) {
      // Revoke any previous blob URL for this asset before creating a new one.
      const prev = blobUrlRegistry.get(asset.id);
      if (prev) URL.revokeObjectURL(prev);
      const blobUrl = URL.createObjectURL(file);
      blobUrlRegistry.set(asset.id, blobUrl);
      setLocalPreviewUrl(blobUrl);
    }

    onUpdate({ uploadStatus: "uploading", error: undefined });
    try {
      const result = await upload({ file, type: mediaType, adAccountId });
      onUpdate({
        uploadedUrl: result.url,
        thumbnailUrl: result.previewUrl ?? result.url,
        assetHash: result.hash,
        videoId: result.videoId,
        uploadStatus: "uploaded",
      });
    } catch (err) {
      onUpdate({
        uploadStatus: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  function handleRemove() {
    // Clean up blob URL from the registry and revoke it.
    const blobUrl = blobUrlRegistry.get(asset.id);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrlRegistry.delete(asset.id);
    }
    setLocalPreviewUrl(null);
    onUpdate({
      uploadedUrl: undefined,
      thumbnailUrl: undefined,
      assetHash: undefined,
      videoId: undefined,
      uploadStatus: "pending",
      error: undefined,
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* ── Ratio label row ── */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold">{ratioInfo.label}</span>
        <span className="text-[10px] text-muted-foreground">{ratioInfo.desc}</span>
      </div>

      {/* ── Aspect-ratio preview / upload zone ─────────────────────────────
          group/slot enables the X remove button to appear on hover without
          conflicting with the inner group used for the expand overlay.        ── */}
      <div
        onDragOver={(e) => { if (!isUploaded) { e.preventDefault(); setIsDragOver(true); } }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => { if (!isUploaded) handleDrop(e); }}
        className={`group/slot relative ${aspectClass} w-full overflow-hidden rounded-xl border-2 border-dashed transition-colors
          ${isUploaded
            ? "border-primary/40 bg-primary-light"
            : isDragOver
              ? "border-primary bg-primary-light/50"
              : isError
                ? "border-destructive/40 bg-destructive/5"
                : "border-border bg-muted/30 hover:border-border-strong"
          }`}
      >
        {/* ── Uploading spinner ── */}
        {isUploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-[10px] text-muted-foreground">Uploading…</span>
          </div>
        )}

        {/* ── Uploaded: unified preview with expand-on-hover ── */}
        {isUploaded && (
          <div
            role="button"
            tabIndex={0}
            aria-label="View full asset"
            onClick={() => setViewerOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewerOpen(true); }
            }}
            className="group/expand absolute inset-0 cursor-pointer outline-none"
          >
            {/* Image media */}
            {!isVideo && (asset.thumbnailUrl ?? asset.uploadedUrl) && (
              <img
                src={asset.thumbnailUrl ?? asset.uploadedUrl}
                alt={`${asset.aspectRatio} preview`}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
                draggable={false}
              />
            )}

            {/* Video media — local blob first (shows real first frame),
                fall back to Meta thumbnail, then dark placeholder */}
            {isVideo && (
              <>
                {localPreviewUrl ? (
                  <video
                    key={localPreviewUrl}
                    src={localPreviewUrl}
                    className="absolute inset-0 h-full w-full object-cover"
                    muted
                    preload="metadata"
                    playsInline
                  />
                ) : asset.thumbnailUrl ? (
                  <img
                    src={asset.thumbnailUrl}
                    alt={`${asset.aspectRatio} video thumbnail`}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="absolute inset-0 bg-foreground/10" />
                )}
                {/* Play indicator — fades out when expand hover appears */}
                <div className="absolute inset-0 flex items-center justify-center transition-opacity group-hover/expand:opacity-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                    <Play className="h-4 w-4 fill-white text-white" style={{ marginLeft: 2 }} />
                  </div>
                </div>
              </>
            )}

            {/* Fallback: no media URLs at all */}
            {!isVideo && !asset.thumbnailUrl && !asset.uploadedUrl && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Check className="h-7 w-7 text-primary" />
              </div>
            )}

            {/* Expand hover overlay */}
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition-all duration-150 group-hover/expand:bg-black/45 group-hover/expand:opacity-100">
              <div className="flex flex-col items-center gap-1.5 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
                <Maximize2 className="h-5 w-5 drop-shadow" />
                <span className="text-[10px] font-semibold tracking-wide">View</span>
              </div>
            </div>
          </div>
        )}

        {/* ── X remove button (top-right corner, above expand area) ─────────
            Uses group/slot so it appears on hover independently of the expand
            overlay. stopPropagation prevents the viewer from opening.         ── */}
        {isUploaded && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleRemove(); }}
            aria-label="Remove asset"
            className="absolute right-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover/slot:opacity-100 hover:bg-destructive"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}

        {/* ── Idle: upload zone ── */}
        {!isUploading && !isUploaded && !isError && adAccountId && (
          <label
            htmlFor={inputId}
            className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1.5 p-3"
          >
            <input
              id={inputId}
              type="file"
              accept={accept}
              className="sr-only"
              onChange={handleInputChange}
            />
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-center text-[11px] leading-snug text-muted-foreground">
              Drop or click<br />
              <span className="font-medium text-foreground">
                {isVideo ? "MP4 / MOV" : "JPEG / PNG"}
              </span>
            </span>
          </label>
        )}

        {/* ── No ad account ── */}
        {!isUploading && !isUploaded && !isError && !adAccountId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3">
            <Upload className="h-4 w-4 text-muted-foreground/40" />
            <span className="text-center text-[10px] leading-snug text-muted-foreground/50">
              Select ad account<br />to enable upload
            </span>
          </div>
        )}

        {/* ── Error state ── */}
        {isError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3">
            <p className="text-center text-[10px] leading-snug text-destructive">
              {asset.error ?? "Upload failed"}
            </p>
            {adAccountId && (
              <label
                htmlFor={`${inputId}-retry`}
                className="cursor-pointer text-[10px] font-medium text-primary hover:underline"
              >
                <input
                  id={`${inputId}-retry`}
                  type="file"
                  accept={accept}
                  className="sr-only"
                  onChange={handleInputChange}
                />
                Retry
              </label>
            )}
          </div>
        )}
      </div>

      {/* ── Footer: type badge only (remove is now the X overlay above) ── */}
      {isUploaded && (
        <div className="px-0.5">
          <Badge variant="success" className="text-[10px]">
            {isVideo ? "Video" : "Uploaded"}
          </Badge>
        </div>
      )}

      {/* ── Media viewer modal ── */}
      <MediaViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        isVideo={isVideo}
        imageUrl={asset.uploadedUrl ?? asset.thumbnailUrl}
        videoUrl={localPreviewUrl ?? undefined}
        aspectRatio={asset.aspectRatio}
      />
    </div>
  );
}

// ─── Asset variation card ─────────────────────────────────────────────────────

function AssetVariationCard({
  variation,
  index,
  mediaType,
  adAccountId,
  canRemove,
  onUpdate,
  onRemove,
}: {
  variation: AssetVariation;
  index: number;
  mediaType: "image" | "video";
  adAccountId?: string;
  canRemove: boolean;
  onUpdate: (patch: Partial<AssetVariation>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const slots = variation.assets ?? [];
  const uploadedCount = slots.filter((a) => a.uploadStatus === "uploaded").length;
  const allDone = slots.length > 0 && uploadedCount === slots.length;

  function updateAsset(assetId: string, patch: Partial<Asset>) {
    onUpdate({
      assets: slots.map((a) => (a.id === assetId ? { ...a, ...patch } : a)),
    });
  }

  return (
    <div className="rounded-lg border border-border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); }
        }}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{variation.name || `Variation ${index + 1}`}</span>
          <Badge variant={allDone ? "success" : "outline"} className="text-[10px]">
            {uploadedCount}/{slots.length} uploaded
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {canRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="rounded p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          <Input
            label="Variation Name"
            value={variation.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder={`Variation ${index + 1}`}
          />
          <div className={`grid gap-4 ${
            slots.length === 1
              ? "max-w-[150px] grid-cols-1"
              : slots.length === 2
                ? "max-w-[320px] grid-cols-2"
                : "max-w-[480px] grid-cols-3"
          }`}>
            {slots.map((asset) => (
              <AssetSlot
                key={asset.id}
                asset={asset}
                mediaType={mediaType}
                adAccountId={adAccountId}
                onUpdate={(patch) => updateAsset(asset.id, patch)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Media viewer modal (lightbox) ───────────────────────────────────────────

function MediaViewerModal({
  open,
  onClose,
  isVideo,
  imageUrl,
  videoUrl,
  aspectRatio,
}: {
  open: boolean;
  onClose: () => void;
  isVideo: boolean;
  /** Full-size image URL, or video thumbnail when no local video URL exists */
  imageUrl?: string;
  /** Local blob URL for the original video file (session only) */
  videoUrl?: string;
  aspectRatio: AssetRatio;
}) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Backdrop — click outside to close
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Content wrapper — stops backdrop click from propagating */}
      <div
        className="relative flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <div className="flex w-full justify-end">
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isVideo ? (
          videoUrl ? (
            // ── Full video playback (local blob URL available) ──────────────
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              autoPlay
              muted
              playsInline
              className="max-h-[80vh] rounded-xl shadow-2xl"
              style={{ maxWidth: "min(85vw, 640px)" }}
            />
          ) : imageUrl ? (
            // ── Video thumbnail only (uploaded to Meta; local file gone) ────
            <div className="relative">
              <img
                src={imageUrl}
                alt={`${aspectRatio} video thumbnail`}
                className="max-h-[80vh] rounded-xl shadow-2xl"
                style={{ maxWidth: "min(85vw, 640px)" }}
                draggable={false}
              />
              {/* Non-interactive play icon over thumbnail */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
                  <Play className="h-8 w-8 fill-white text-white" style={{ marginLeft: 3 }} />
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] text-white/40">
                Video uploaded to Meta · thumbnail preview only
              </p>
            </div>
          ) : (
            // ── No preview at all ───────────────────────────────────────────
            <div className="flex h-48 w-48 flex-col items-center justify-center gap-3 rounded-xl bg-white/5">
              <Video className="h-12 w-12 text-white/25" />
              <p className="text-sm text-white/40">No preview available</p>
            </div>
          )
        ) : imageUrl ? (
          // ── Full-size image ─────────────────────────────────────────────
          <img
            src={imageUrl}
            alt={`${aspectRatio} asset`}
            className="max-h-[80vh] rounded-xl shadow-2xl"
            style={{ maxWidth: "min(85vw, 800px)" }}
            draggable={false}
          />
        ) : (
          // ── No image URL ────────────────────────────────────────────────
          <div className="flex h-48 w-48 flex-col items-center justify-center gap-3 rounded-xl bg-white/5">
            <ImageIcon className="h-12 w-12 text-white/25" />
            <p className="text-sm text-white/40">No preview available</p>
          </div>
        )}

        {/* Ratio label */}
        <p className="text-[11px] text-white/40">
          {RATIO_LABELS[aspectRatio]?.label} · {RATIO_LABELS[aspectRatio]?.desc}
        </p>
      </div>
    </div>
  );
}
