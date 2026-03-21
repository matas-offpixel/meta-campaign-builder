"use client";

import { useState, useCallback, useRef, useMemo } from "react";
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
} from "lucide-react";
import type {
  AdCreativeDraft, CTAType, AssetMode, AssetRatio,
  AdSourceType, AssetVariation, CaptionVariant,
} from "@/lib/types";
import {
  CTA_OPTIONS, MOCK_FACEBOOK_PAGES, MOCK_INSTAGRAM_ACCOUNTS,
  MOCK_PAGE_POSTS,
} from "@/lib/mock-data";
import {
  createDefaultCreative, createDefaultAssetVariation, createDefaultCaption,
} from "@/lib/campaign-defaults";

interface CreativesProps {
  creatives: AdCreativeDraft[];
  onChange: (creatives: AdCreativeDraft[]) => void;
}

const ASSET_MODES: { value: AssetMode; label: string; desc: string; ratios: AssetRatio[] }[] = [
  { value: "single", label: "Single", desc: "9:16 only", ratios: ["9:16"] },
  { value: "dual", label: "Dual", desc: "4:5 + 9:16", ratios: ["4:5", "9:16"] },
  { value: "full", label: "Full", desc: "1:1 + 4:5 + 9:16", ratios: ["1:1", "4:5", "9:16"] },
];

const RATIO_META: Record<AssetRatio, { label: string; desc: string }> = {
  "1:1": { label: "1:1", desc: "Square" },
  "4:5": { label: "4:5", desc: "Feed" },
  "9:16": { label: "9:16", desc: "Story/Reel" },
};

type BulkField = "headline" | "description" | "destinationUrl" | "cta";

function getRatiosForMode(mode: AssetMode): AssetRatio[] {
  return ASSET_MODES.find((m) => m.value === mode)?.ratios ?? ["4:5", "9:16"];
}

export function Creatives({ creatives, onChange }: CreativesProps) {
  const [activeId, setActiveId] = useState<string | null>(creatives[0]?.id ?? null);
  const [appliedField, setAppliedField] = useState<BulkField | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [postSearch, setPostSearch] = useState("");

  const active = creatives.find((c) => c.id === activeId);
  const activeRatios = active ? getRatiosForMode(active.assetMode ?? "dual") : [];

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
        assets: { ...v.assets },
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
    const page = MOCK_FACEBOOK_PAGES.find((p) => p.id === pageId);
    const linkedIg = page?.linkedInstagramId || "";
    updateAd(adId, {
      identity: { pageId, instagramAccountId: linkedIg },
    });
  };

  // ─── Asset variations ───
  const addAssetVariation = (adId: string) => {
    const ad = creatives.find((c) => c.id === adId);
    if (!ad) return;
    const vars = ad.assetVariations ?? [];
    const v = createDefaultAssetVariation();
    v.name = `Variation ${vars.length + 1}`;
    updateAd(adId, { assetVariations: [...vars, v] });
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
      const ratios = getRatiosForMode(c.assetMode);
      const assets: Record<string, string> = {};
      ratios.forEach((r) => { assets[r] = `mock_${r}_file${i + 1}_${Date.now()}`; });
      c.assetVariations = [{ id: crypto.randomUUID(), name: `Variation 1`, assets }];
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
                const page = MOCK_FACEBOOK_PAGES.find((p) => p.id === c.identity?.pageId);
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
                    <Select
                      label="Facebook Page"
                      value={active.identity?.pageId ?? ""}
                      onChange={(e) => handlePageChange(active.id, e.target.value)}
                      placeholder="Select page..."
                      options={MOCK_FACEBOOK_PAGES.map((p) => ({ value: p.id, label: p.name }))}
                    />
                    <Select
                      label="Instagram Account"
                      value={active.identity?.instagramAccountId ?? ""}
                      onChange={(e) => updateAd(active.id, {
                        identity: { ...(active.identity ?? { pageId: "", instagramAccountId: "" }), instagramAccountId: e.target.value },
                      })}
                      placeholder="Select account..."
                      options={MOCK_INSTAGRAM_ACCOUNTS.map((a) => ({
                        value: a.id,
                        label: `${a.name} (${a.username})`,
                      }))}
                    />
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
                                onClick={() => updateAd(active.id, { assetMode: mode.value })}
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
                          <Button variant="outline" size="sm" onClick={() => addAssetVariation(active.id)}>
                            <Plus className="h-3 w-3" /> Add Variation
                          </Button>
                        </div>
                        <div className="space-y-3">
                          {(active.assetVariations ?? []).map((variation, vi) => (
                            <AssetVariationCard
                              key={variation.id}
                              variation={variation}
                              index={vi}
                              ratios={activeRatios}
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

function AssetVariationCard({
  variation,
  index,
  ratios,
  canRemove,
  onUpdate,
  onRemove,
}: {
  variation: AssetVariation;
  index: number;
  ratios: AssetRatio[];
  canRemove: boolean;
  onUpdate: (patch: Partial<AssetVariation>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const assetCount = Object.keys(variation.assets).length;

  return (
    <div className="rounded-lg border border-border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{variation.name || `Variation ${index + 1}`}</span>
          <Badge variant={assetCount > 0 ? "success" : "outline"} className="text-[10px]">
            {assetCount}/{ratios.length} uploaded
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
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
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
          <div className={`grid gap-3 ${ratios.length === 1 ? "grid-cols-1 max-w-[200px]" : ratios.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
            {ratios.map((ratio) => {
              const meta = RATIO_META[ratio];
              const hasAsset = !!variation.assets[ratio];
              return (
                <div
                  key={ratio}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-3
                    ${hasAsset ? "border-primary bg-primary-light" : "border-border bg-muted/30"}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">{meta.desc}</span>
                  </div>
                  {hasAsset ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="success">Uploaded</Badge>
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...variation.assets };
                          delete next[ratio];
                          onUpdate({ assets: next });
                        }}
                        className="text-xs text-destructive hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onUpdate({ assets: { ...variation.assets, [ratio]: `mock_${ratio}_v${variation.id}_${Date.now()}` } });
                      }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Upload {meta.label}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
