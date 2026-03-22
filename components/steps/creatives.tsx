"use client";

import { useState, useCallback, useRef, useMemo, useEffect, useId } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import {
  Plus, Copy, Trash2, ImageIcon, Video, Upload,
  ClipboardCopy, Check, FileText, ShieldOff,
  Heart, MessageCircle, Share2, ChevronDown, ChevronUp,
  AlertCircle,
} from "lucide-react";
import type {
  AdCreativeDraft, CTAType, AssetMode, AssetRatio,
  AdSourceType, AssetVariation, Asset, CaptionVariant,
} from "@/lib/types";
import { useUploadAsset } from "@/lib/hooks/useUploadAsset";
import { getAspectRatioSlots } from "@/lib/meta/upload";
import { CTA_OPTIONS, MOCK_PAGE_POSTS } from "@/lib/mock-data";
import { useFetchPages, useFetchInstagramAccounts } from "@/lib/hooks/useMeta";
import {
  createDefaultCreative,
  createDefaultAssetVariation,
  createDefaultAsset,
  createDefaultCaption,
} from "@/lib/campaign-defaults";

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
    // Auto-link the Instagram account associated with this page
    const linkedIg = igAccounts.data.find((ig) => ig.linkedPageId === pageId)?.id ?? "";
    updateAd(adId, {
      identity: { pageId, instagramAccountId: linkedIg },
    });
  };

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
  const filteredPosts = useMemo(() => {
    if (!active) return [];
    const pageId = active.identity?.pageId;
    let posts = MOCK_PAGE_POSTS.filter((p) => p.pageId === pageId);
    if (postSearch) {
      posts = posts.filter((p) => p.message.toLowerCase().includes(postSearch.toLowerCase()));
    }
    return posts;
  }, [active, postSearch]);

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
                      {/* Filter IG accounts to those linked to the selected page */}
                      {(() => {
                        const selectedPageId = active.identity?.pageId;
                        const filteredIG = selectedPageId
                          ? igAccounts.data.filter((ig) => ig.linkedPageId === selectedPageId)
                          : igAccounts.data;
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
                                igAccounts.loading
                                  ? "Loading…"
                                  : !selectedPageId
                                    ? "Select a page first…"
                                    : "Select account…"
                              }
                              disabled={igAccounts.loading || !selectedPageId}
                              options={[
                                { value: "", label: "— None —" },
                                ...filteredIG.map((ig) => ({
                                  value: ig.id,
                                  label: ig.username ? `@${ig.username}` : (ig.name ?? ig.id),
                                })),
                              ]}
                            />
                            <FieldStatus loading={igAccounts.loading} error={igAccounts.error} />
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
                  <CardTitle>Select Existing Post</CardTitle>
                  <CardDescription>
                    {active.identity?.pageId
                      ? "Choose a published post from the selected page's feed."
                      : "Select a Facebook Page above to see available posts."}
                  </CardDescription>

                  {active.identity?.pageId && (
                    <div className="mt-4 space-y-3">
                      <SearchInput
                        value={postSearch}
                        onChange={(e) => setPostSearch(e.target.value)}
                        onClear={() => setPostSearch("")}
                        placeholder="Search posts..."
                      />
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {filteredPosts.length === 0 && (
                          <p className="py-4 text-center text-sm text-muted-foreground">No posts found for this page.</p>
                        )}
                        {filteredPosts.map((post) => {
                          const isSelected = active.existingPost?.postId === post.id;
                          return (
                            <button
                              key={post.id}
                              type="button"
                              onClick={() => updateAd(active.id, {
                                existingPost: { postId: post.id, postPreview: post.message },
                              })}
                              className={`w-full rounded-lg border p-3 text-left transition-colors
                                ${isSelected ? "border-primary bg-primary-light" : "border-border hover:bg-muted/50"}`}
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                                  {post.type === "video" ? (
                                    <Video className="h-4 w-4 text-muted-foreground" />
                                  ) : post.type === "link" ? (
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                  ) : (
                                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 text-sm">{post.message}</p>
                                  <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                                    <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                                    <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{post.likes.toLocaleString()}</span>
                                    <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{post.comments.toLocaleString()}</span>
                                    <span className="flex items-center gap-0.5"><Share2 className="h-3 w-3" />{post.shares.toLocaleString()}</span>
                                  </div>
                                </div>
                                {isSelected && <Badge variant="primary">Selected</Badge>}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Optional CTA/URL override for existing posts */}
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
                    </div>
                  )}
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

  const ratioInfo = RATIO_LABELS[asset.aspectRatio];
  const accept = "image/jpeg,image/png,video/mp4";
  const isUploading = asset.uploadStatus === "uploading";
  const isUploaded = asset.uploadStatus === "uploaded";
  const isError = asset.uploadStatus === "error";

  async function handleFile(file: File) {
    if (!adAccountId || isUploading) return;
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
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center rounded-xl border-2 border-dashed transition-colors overflow-hidden
        ${isUploaded
          ? "border-primary bg-primary-light"
          : isDragOver
            ? "border-primary bg-primary-light/50"
            : isError
              ? "border-destructive/50 bg-destructive/5"
              : "border-border bg-muted/30 hover:border-border-strong"
        }`}
    >
      {/* Ratio label */}
      <div className="flex w-full items-center justify-between px-2.5 pt-2 pb-1">
        <span className="text-xs font-semibold">{ratioInfo.label}</span>
        <span className="text-[10px] text-muted-foreground">{ratioInfo.desc}</span>
      </div>

      {/* Content area */}
      {isUploading ? (
        <div className="flex flex-col items-center gap-1.5 py-5">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-[10px] text-muted-foreground">Uploading…</span>
        </div>
      ) : isUploaded ? (
        <div className="flex w-full flex-col items-center gap-1.5 pb-2">
          {asset.thumbnailUrl ? (
            <img
              src={asset.thumbnailUrl}
              alt={`${asset.aspectRatio} preview`}
              className="h-20 w-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-full items-center justify-center bg-muted/40">
              <Check className="h-6 w-6 text-primary" />
            </div>
          )}
          <div className="flex items-center gap-2 px-2">
            <Badge variant="success" className="text-[10px]">Uploaded</Badge>
            <button
              type="button"
              onClick={handleRemove}
              className="text-[10px] text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        </div>
      ) : adAccountId ? (
        <label
          htmlFor={inputId}
          className="flex w-full cursor-pointer flex-col items-center gap-2 px-2 pb-4 pt-2"
        >
          <input
            id={inputId}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={handleInputChange}
          />
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="text-center text-[11px] leading-tight text-muted-foreground">
            Drop or click<br />
            <span className="font-medium text-foreground">
              {mediaType === "video" ? "MP4" : "JPEG / PNG"}
            </span>
          </span>
        </label>
      ) : (
        <div className="flex flex-col items-center gap-1 px-2 pb-4 pt-2">
          <Upload className="h-4 w-4 text-muted-foreground/50" />
          <span className="text-center text-[10px] leading-tight text-muted-foreground/60">
            Select ad account<br />to enable upload
          </span>
        </div>
      )}

      {isError && (
        <div className="w-full px-2 pb-2">
          <p className="text-center text-[10px] text-destructive leading-tight">
            {asset.error ?? "Upload failed"}
          </p>
          {adAccountId && (
            <label
              htmlFor={`${inputId}-retry`}
              className="block cursor-pointer text-center text-[10px] font-medium text-primary hover:underline mt-0.5"
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
          <div className={`grid gap-3 ${
            slots.length === 1
              ? "max-w-[180px] grid-cols-1"
              : slots.length === 2
                ? "grid-cols-2"
                : "grid-cols-3"
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
