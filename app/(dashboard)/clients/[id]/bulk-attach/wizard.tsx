"use client";

/**
 * /clients/[id]/bulk-attach — client-level bulk attach wizard.
 *
 * Identical 4-step flow to /events/[id]/bulk-attach but scoped to the
 * entire client ad account (cross-event) rather than a single event.
 * The adAccountId is resolved server-side and injected as a prop so
 * there is no manual ad account entry step.
 *
 * Differences from the event-scoped wizard:
 *   - adAccountId is a required prop (no guard / input form)
 *   - Back link → /clients/[id]?tab=campaigns
 *   - Draft persistence: clientId stored instead of eventId
 *   - Draft listing: all user drafts (no event_id filter)
 *   - localStorage key: bulk-attach-unsaved-client-[clientId]
 *   - No preselectCodes (event-specific feature)
 *
 * All shared components, API endpoints, hard caps, serial execution,
 * and creative builders are identical to the event-scoped page.
 * ACTIVE creation default (PRs #540/#541) and creative payload fixes
 * (PRs #551/#554/#568/#570/#575) apply because they live in shared code.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Save,
  FolderOpen,
  Trash2,
  X,
  LayoutTemplate,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Creatives } from "@/components/steps/creatives";
import { CampaignMultiPicker } from "@/components/bulk-attach/campaign-multi-picker";
import { AdSetPicker } from "@/components/bulk-attach/ad-set-picker";
import { createDefaultCreative } from "@/lib/campaign-defaults";
import {
  serialiseDraftState,
  deserialiseDraftState,
  hasMeaningfulState,
  defaultDraftName,
} from "@/lib/bulk-attach/draft-state";
import { parsePatternTerms } from "@/lib/bulk-attach/template-matcher";
import type { AdCreativeDraft, MetaCampaignSummary } from "@/lib/types";
import type { BulkAttachResult } from "@/app/api/meta/bulk-attach-ads/route";

const BULK_ATTACH_CAP = 8;

interface Props {
  clientId: string;
  clientName: string;
  adAccountId: string;
}

type Step = 0 | 1 | 2 | 3;

interface DraftListItem {
  id: string;
  name: string;
  updated_at: string;
  event_id: string | null;
}

interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  match_pattern: {
    campaign_name_contains?: string[];
    ad_set_name_contains?: string[];
  };
  creative_config: {
    headline?: string;
    description?: string;
    cta?: string;
    destination_url?: string;
  };
  use_count: number;
  updated_at: string;
}

interface TemplateApplyPreview {
  matchedCampaignIds: string[];
  unmatchedCampaignPatterns: string[];
  suggestionConfidence: "high" | "low";
  adSetMatchPattern: string[];
  matchedCampaigns: MetaCampaignSummary[];
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const labels = [
    "Select campaigns",
    "Select ad sets",
    "Configure creatives",
    "Review & launch",
  ];
  return (
    <ol className="flex flex-wrap items-center gap-0 text-xs">
      {labels.map((label, i) => {
        const active = step === i;
        const done = step > i;
        return (
          <li key={i} className="flex items-center gap-1">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold
                ${done || active ? "bg-primary text-background" : "bg-muted text-muted-foreground"}`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={
                active
                  ? "font-medium text-foreground"
                  : done
                    ? "text-foreground/70"
                    : "text-muted-foreground"
              }
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <ChevronRight className="mx-1 h-3 w-3 text-muted-foreground" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export function ClientBulkAttachWizard({
  clientId,
  clientName,
  adAccountId,
}: Props) {
  const router = useRouter();
  const lsKey = `bulk-attach-unsaved-client-${clientId}`;

  // ── Step ────────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(0);

  // ── Step 0: campaign selection ───────────────────────────────────────────────
  const [selectedCampaigns, setSelectedCampaigns] = useState<
    Map<string, MetaCampaignSummary>
  >(new Map());

  const handleToggleCampaign = useCallback(
    (campaign: MetaCampaignSummary) => {
      setSelectedCampaigns((prev) => {
        const next = new Map(prev);
        if (next.has(campaign.id)) {
          next.delete(campaign.id);
        } else {
          if (next.size >= BULK_ATTACH_CAP) return prev;
          next.set(campaign.id, campaign);
        }
        return next;
      });
    },
    [],
  );

  const selectedIds = new Set(selectedCampaigns.keys());

  // ── Step 1: ad set selection ─────────────────────────────────────────────────
  const [campaignAdSets, setCampaignAdSets] = useState<
    Map<string, Set<string>>
  >(new Map());

  const allCampaignsHaveAdSets =
    campaignAdSets.size > 0 &&
    Array.from(selectedCampaigns.keys()).every(
      (cid) => (campaignAdSets.get(cid)?.size ?? 0) > 0,
    );

  const adSetValidationError = !allCampaignsHaveAdSets
    ? "Each selected campaign must have at least one ad set selected."
    : null;

  // ── Step 2: creatives ────────────────────────────────────────────────────────
  const [creatives, setCreatives] = useState<AdCreativeDraft[]>([
    createDefaultCreative(),
  ]);

  // ── Step 3: launch ───────────────────────────────────────────────────────────
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<BulkAttachResult | null>(
    null,
  );
  const [launchError, setLaunchError] = useState<string | null>(null);

  // ── Active template match pattern (from applied template, step 1) ────────────
  const [adSetMatchPattern, setAdSetMatchPattern] = useState<string[]>([]);

  // ── Draft save state ─────────────────────────────────────────────────────────
  const [draftId, setDraftId] = useState<string | null>(null);
  const [showDraftNameInput, setShowDraftNameInput] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedDraftToast, setSavedDraftToast] = useState(false);
  const [saveDraftError, setSaveDraftError] = useState<string | null>(null);

  // ── Draft resume modal state ─────────────────────────────────────────────────
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftsList, setDraftsList] = useState<DraftListItem[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);

  // ── Unsaved-changes banner ───────────────────────────────────────────────────
  const [showUnsavedBanner, setShowUnsavedBanner] = useState(false);
  const mountedRef = useRef(false);

  // ── Template save form state ─────────────────────────────────────────────────
  const [showTemplateSaveForm, setShowTemplateSaveForm] = useState(false);
  const [templateSaveName, setTemplateSaveName] = useState("");
  const [templateSaveDescription, setTemplateSaveDescription] = useState("");
  const [templateCampaignFilter, setTemplateCampaignFilter] = useState("");
  const [templateAdSetFilter, setTemplateAdSetFilter] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savedTemplateToast, setSavedTemplateToast] = useState(false);
  const [saveTemplateError, setSaveTemplateError] = useState<string | null>(
    null,
  );

  // ── Template load modal state ────────────────────────────────────────────────
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templatesList, setTemplatesList] = useState<TemplateListItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(
    null,
  );
  const [selectedTemplate, setSelectedTemplate] =
    useState<TemplateListItem | null>(null);
  const [templatePreview, setTemplatePreview] =
    useState<TemplateApplyPreview | null>(null);
  const [templatePreviewLoading, setTemplatePreviewLoading] = useState(false);

  // ── Computed totals ──────────────────────────────────────────────────────────
  const totalSelectedAdSets = Array.from(campaignAdSets.values()).reduce(
    (sum, s) => sum + s.size,
    0,
  );
  const totalAdsToCreate = totalSelectedAdSets * creatives.length;

  // ── localStorage autosave ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) return;
    try {
      const serialised = serialiseDraftState({
        adAccountId,
        step,
        selectedCampaigns,
        campaignAdSets,
        creatives,
      });
      localStorage.setItem(lsKey, JSON.stringify(serialised));
    } catch {
      // localStorage may be full or disabled
    }
  }, [step, selectedCampaigns, campaignAdSets, creatives, adAccountId, lsKey]);

  // ── Mount: check localStorage for unsaved state ──────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const live = deserialiseDraftState(JSON.parse(raw));
      if (live && hasMeaningfulState(live)) setShowUnsavedBanner(true);
    } catch {
      // ignore corrupt storage
    }
  }, [lsKey]);

  // ── Restore from localStorage ────────────────────────────────────────────────
  const handleRestoreFromLocalStorage = () => {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const live = deserialiseDraftState(JSON.parse(raw));
      if (!live) return;
      setStep(live.step as Step);
      setSelectedCampaigns(live.selectedCampaigns);
      setCampaignAdSets(live.campaignAdSets);
      setCreatives(live.creatives);
    } catch {
      // ignore
    } finally {
      setShowUnsavedBanner(false);
    }
  };

  // ── Save draft ───────────────────────────────────────────────────────────────
  const openDraftNameInput = () => {
    setDraftNameInput(defaultDraftName(clientId));
    setShowDraftNameInput(true);
    setSaveDraftError(null);
  };

  const handleSaveDraft = async () => {
    if (!draftNameInput.trim()) return;
    setSavingDraft(true);
    setSaveDraftError(null);
    try {
      const state = serialiseDraftState({
        adAccountId,
        step,
        selectedCampaigns,
        campaignAdSets,
        creatives,
      });
      const res = await fetch("/api/bulk-attach-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draftId ?? undefined,
          eventId: null,
          clientId,
          name: draftNameInput.trim(),
          state,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setDraftId(data.draft.id);
      setShowDraftNameInput(false);
      try {
        localStorage.removeItem(lsKey);
      } catch {
        /**/
      }
      setSavedDraftToast(true);
      setTimeout(() => setSavedDraftToast(false), 3000);
    } catch (err) {
      setSaveDraftError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingDraft(false);
    }
  };

  // ── Draft modal ──────────────────────────────────────────────────────────────
  // Lists all user drafts (no event_id filter) — the most useful scope here.
  const handleOpenDraftModal = async () => {
    setShowDraftModal(true);
    setDraftsLoading(true);
    try {
      const res = await fetch("/api/bulk-attach-drafts");
      const data = await res.json();
      setDraftsList((data.drafts ?? []) as DraftListItem[]);
    } catch {
      setDraftsList([]);
    } finally {
      setDraftsLoading(false);
    }
  };

  const handleLoadDraft = async (id: string) => {
    try {
      const res = await fetch(`/api/bulk-attach-drafts/${id}`);
      const data = await res.json();
      if (!res.ok || !data.draft) return;
      const live = deserialiseDraftState(data.draft.state);
      if (!live) return;
      setDraftId(id);
      setStep(live.step as Step);
      setSelectedCampaigns(live.selectedCampaigns);
      setCampaignAdSets(live.campaignAdSets);
      setCreatives(live.creatives);
      setShowDraftModal(false);
      setShowUnsavedBanner(false);
    } catch {
      // state unchanged on error
    }
  };

  const handleDeleteDraft = async (id: string) => {
    setDeletingDraftId(id);
    try {
      await fetch(`/api/bulk-attach-drafts/${id}`, { method: "DELETE" });
      setDraftsList((prev) => prev.filter((d) => d.id !== id));
      if (draftId === id) setDraftId(null);
    } catch {
      // ignore
    } finally {
      setDeletingDraftId(null);
    }
  };

  // ── Save template ────────────────────────────────────────────────────────────
  const openTemplateSaveForm = () => {
    setTemplateSaveName("");
    setTemplateSaveDescription("");
    setTemplateCampaignFilter("");
    setTemplateAdSetFilter("");
    setSaveTemplateError(null);
    setShowTemplateSaveForm(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateSaveName.trim()) return;
    setSavingTemplate(true);
    setSaveTemplateError(null);

    const matchPattern = {
      ...(templateCampaignFilter.trim()
        ? {
            campaign_name_contains: parsePatternTerms(templateCampaignFilter),
          }
        : {}),
      ...(templateAdSetFilter.trim()
        ? { ad_set_name_contains: parsePatternTerms(templateAdSetFilter) }
        : {}),
    };

    const firstCreative = creatives[0];
    const creativeConfig = {
      headline: firstCreative?.headline ?? undefined,
      description: firstCreative?.description ?? undefined,
      cta: firstCreative?.cta ?? undefined,
      destination_url: firstCreative?.destinationUrl ?? undefined,
    };

    try {
      const res = await fetch("/api/bulk-attach-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateSaveName.trim(),
          description: templateSaveDescription.trim() || null,
          matchPattern,
          creativeConfig,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setShowTemplateSaveForm(false);
      setSavedTemplateToast(true);
      setTimeout(() => setSavedTemplateToast(false), 3000);
    } catch (err) {
      setSaveTemplateError(
        err instanceof Error ? err.message : "Save failed",
      );
    } finally {
      setSavingTemplate(false);
    }
  };

  // ── Load template modal ──────────────────────────────────────────────────────
  const handleOpenTemplateModal = async () => {
    setSelectedTemplate(null);
    setTemplatePreview(null);
    setShowTemplateModal(true);
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/bulk-attach-templates");
      const data = await res.json();
      setTemplatesList((data.templates ?? []) as TemplateListItem[]);
    } catch {
      setTemplatesList([]);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    setDeletingTemplateId(id);
    try {
      await fetch(`/api/bulk-attach-templates/${id}`, { method: "DELETE" });
      setTemplatesList((prev) => prev.filter((t) => t.id !== id));
      if (selectedTemplate?.id === id) {
        setSelectedTemplate(null);
        setTemplatePreview(null);
      }
    } catch {
      // ignore
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const handlePreviewTemplate = async (template: TemplateListItem) => {
    setSelectedTemplate(template);
    setTemplatePreview(null);
    setTemplatePreviewLoading(true);
    try {
      const campaignRes = await fetch(
        `/api/meta/campaigns?adAccountId=${encodeURIComponent(adAccountId)}&filter=relevant&limit=50`,
      );
      const campaignData = await campaignRes.json();
      const allCampaigns: MetaCampaignSummary[] = (campaignData.data ??
        []) as MetaCampaignSummary[];

      const applyRes = await fetch(
        `/api/bulk-attach-templates/${template.id}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaigns: allCampaigns.map((c) => ({ id: c.id, name: c.name })),
          }),
        },
      );
      const applyData = await applyRes.json();

      const matchedIds = new Set<string>(applyData.matchedCampaignIds ?? []);
      const matchedCampaigns = allCampaigns.filter((c) =>
        matchedIds.has(c.id),
      );

      setTemplatePreview({
        matchedCampaignIds: applyData.matchedCampaignIds ?? [],
        unmatchedCampaignPatterns: applyData.unmatchedCampaignPatterns ?? [],
        suggestionConfidence: applyData.suggestionConfidence ?? "low",
        adSetMatchPattern: applyData.adSetMatchPattern ?? [],
        matchedCampaigns,
      });
    } catch {
      setTemplatePreview(null);
    } finally {
      setTemplatePreviewLoading(false);
    }
  };

  const handleApplyTemplate = () => {
    if (!templatePreview || !selectedTemplate) return;
    const capped = templatePreview.matchedCampaigns.slice(0, BULK_ATTACH_CAP);
    const nextMap = new Map<string, MetaCampaignSummary>(
      capped.map((c) => [c.id, c]),
    );
    setSelectedCampaigns(nextMap);
    setCampaignAdSets(new Map());
    setAdSetMatchPattern(templatePreview.adSetMatchPattern);
    setShowTemplateModal(false);
    setSelectedTemplate(null);
    setTemplatePreview(null);
  };

  // ── Launch ───────────────────────────────────────────────────────────────────
  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchError(null);
    const campaignAdSetsPayload: Record<string, string[]> = {};
    for (const [cid, adSetSet] of campaignAdSets.entries()) {
      campaignAdSetsPayload[cid] = Array.from(adSetSet);
    }
    try {
      const res = await fetch("/api/meta/bulk-attach-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          campaignAdSets: campaignAdSetsPayload,
          newCreatives: creatives,
        }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setLaunchError(data.error ?? "Launch failed");
        return;
      }
      setLaunchResult(data as BulkAttachResult);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLaunching(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setLaunchResult(null);
    setStep(0);
    setSelectedCampaigns(new Map());
    setCampaignAdSets(new Map());
    setCreatives([createDefaultCreative()]);
    setDraftId(null);
    setAdSetMatchPattern([]);
    try {
      localStorage.removeItem(lsKey);
    } catch {
      /**/
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href={`/clients/${clientId}?tab=campaigns`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-lg tracking-wide">
            Bulk attach creatives
          </h1>
          <p className="text-xs text-muted-foreground">
            {clientName} · Upload new assets once, attach across multiple live
            campaigns.
          </p>
        </div>

        {/* Draft + template controls */}
        {!launchResult && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-3 text-xs">
              {savedDraftToast && (
                <span className="font-medium text-success">Draft saved</span>
              )}
              {savedTemplateToast && (
                <span className="font-medium text-success">Template saved</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {showDraftNameInput ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={draftNameInput}
                    onChange={(e) => setDraftNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveDraft();
                      if (e.key === "Escape") setShowDraftNameInput(false);
                    }}
                    placeholder="Draft name…"
                    className="w-40 rounded-md border border-border bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveDraft}
                    disabled={savingDraft || !draftNameInput.trim()}
                  >
                    {savingDraft ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDraftNameInput(false)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                  {saveDraftError && (
                    <span className="text-xs text-destructive">
                      {saveDraftError}
                    </span>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openDraftNameInput}
                >
                  <Save className="mr-1 h-3.5 w-3.5" /> Save draft
                </Button>
              )}

              {!showTemplateSaveForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openTemplateSaveForm}
                >
                  <LayoutTemplate className="mr-1 h-3.5 w-3.5" /> Save as
                  template
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Template save form (inline below header) */}
      {showTemplateSaveForm && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Save as template</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTemplateSaveForm(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Templates save match criteria (campaign + ad set name patterns) for
            reuse across events. They do not store campaign or ad set IDs — only
            fuzzy name filters.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                autoFocus
                type="text"
                value={templateSaveName}
                onChange={(e) => setTemplateSaveName(e.target.value)}
                placeholder="e.g. UTB Lookalike template"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Description</label>
              <input
                type="text"
                value={templateSaveDescription}
                onChange={(e) => setTemplateSaveDescription(e.target.value)}
                placeholder="Optional notes"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Campaign filter</label>
              <input
                type="text"
                value={templateCampaignFilter}
                onChange={(e) => setTemplateCampaignFilter(e.target.value)}
                placeholder="e.g. UTB, Summer (comma-separated)"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Campaigns whose name contains ANY of these terms will be
                pre-selected.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Ad set filter</label>
              <input
                type="text"
                value={templateAdSetFilter}
                onChange={(e) => setTemplateAdSetFilter(e.target.value)}
                placeholder="e.g. Lookalike, Remarketing (comma-separated)"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Ad sets whose name contains ANY of these terms will be
                pre-selected.
              </p>
            </div>
          </div>

          {saveTemplateError && (
            <p className="text-xs text-destructive">{saveTemplateError}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTemplateSaveForm(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveTemplate}
              disabled={savingTemplate || !templateSaveName.trim()}
            >
              {savingTemplate ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              Save template
            </Button>
          </div>
        </div>
      )}

      {/* Unsaved changes banner */}
      {showUnsavedBanner && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <span className="flex-1">
            You have unsaved changes from a previous session.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRestoreFromLocalStorage}
          >
            Resume
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowUnsavedBanner(false);
              try {
                localStorage.removeItem(lsKey);
              } catch {
                /**/
              }
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Step indicator */}
      <StepIndicator step={step} />

      {/* ── STEP 0: Select campaigns ──────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Select campaigns</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Max {BULK_ATTACH_CAP}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenDraftModal}
                >
                  <FolderOpen className="mr-1 h-3.5 w-3.5" /> Saved drafts
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenTemplateModal}
                >
                  <LayoutTemplate className="mr-1 h-3.5 w-3.5" /> Load template
                </Button>
              </div>
            </div>
            <CampaignMultiPicker
              adAccountId={adAccountId}
              selectedIds={selectedIds}
              onToggle={handleToggleCampaign}
            />
          </div>

          {selectedCampaigns.size > 0 && (
            <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-card px-4 py-3 shadow-lg">
              <div className="text-sm">
                <span className="font-semibold">{selectedCampaigns.size}</span>{" "}
                <span className="text-muted-foreground">
                  campaign{selectedCampaigns.size !== 1 ? "s" : ""} selected
                </span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">
                  {Array.from(selectedCampaigns.values())
                    .map((c) => c.name || c.id)
                    .join(", ")
                    .slice(0, 60)}
                  {Array.from(selectedCampaigns.values())
                    .map((c) => c.name || c.id)
                    .join(", ").length > 60 && "…"}
                </span>
              </div>
              <Button size="sm" onClick={() => setStep(1)}>
                Continue <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 1: Select ad sets ────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Select ad sets</h2>
              <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>
            {adSetMatchPattern.length > 0 ? (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <LayoutTemplate className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span>Template filter active:</span>
                {adSetMatchPattern.map((t) => (
                  <code
                    key={t}
                    className="rounded bg-muted px-1.5 py-0.5 font-mono"
                  >
                    {t}
                  </code>
                ))}
                <button
                  type="button"
                  onClick={() => setAdSetMatchPattern([])}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <p className="mb-4 text-xs text-muted-foreground">
                New ads will be created in the checked ad sets only. All ad sets
                are pre-selected — uncheck any you want to skip.
              </p>
            )}
            <AdSetPicker
              adAccountId={adAccountId}
              campaigns={selectedCampaigns}
              selection={campaignAdSets}
              onSelectionChange={setCampaignAdSets}
              adSetMatchPattern={
                adSetMatchPattern.length > 0 ? adSetMatchPattern : undefined
              }
            />
          </div>

          {adSetValidationError && (
            <p className="text-xs text-destructive">{adSetValidationError}</p>
          )}

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setStep(2)}
              disabled={!allCampaignsHaveAdSets}
              title={adSetValidationError ?? undefined}
            >
              Continue <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Configure creatives ──────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Configure creatives</h2>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Assets are uploaded once. No audiences, budget, or scheduling —
              those come from the existing ad sets.
            </p>
            <Creatives
              creatives={creatives}
              onChange={setCreatives}
              adAccountId={adAccountId}
            />
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => setStep(3)}
              disabled={
                creatives.length === 0 ||
                !creatives.every((c) =>
                  c.assetVariations?.some((v) =>
                    v.assets?.some((a) => a.uploadStatus === "uploaded"),
                  ),
                )
              }
            >
              Review & launch <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Review & launch ───────────────────────────────────────────── */}
      {step === 3 && !launchResult && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Review</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(2)}
                disabled={launching}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>

            <div className="mb-4 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      Creative
                    </th>
                    {Array.from(selectedCampaigns.values()).map((c) => (
                      <th
                        key={c.id}
                        className="px-3 py-2 text-left font-medium text-muted-foreground"
                      >
                        {c.name || c.id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {creatives.map((cr) => (
                    <tr key={cr.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">
                        {cr.name || "(untitled)"}
                      </td>
                      {Array.from(selectedCampaigns.keys()).map((cid) => {
                        const count = campaignAdSets.get(cid)?.size ?? 0;
                        return (
                          <td
                            key={cid}
                            className="px-3 py-2 text-muted-foreground"
                          >
                            {count} ad{count !== 1 ? "s" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              {creatives.length} creative{creatives.length !== 1 ? "s" : ""} ×{" "}
              {selectedCampaigns.size} campaign
              {selectedCampaigns.size !== 1 ? "s" : ""} ={" "}
              <strong>
                {totalAdsToCreate} ad{totalAdsToCreate !== 1 ? "s" : ""}
              </strong>{" "}
              to be created <strong>ACTIVE</strong>.
            </p>

            {launchError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {launchError}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleLaunch} disabled={launching}>
              {launching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Launching…
                </>
              ) : (
                "Launch"
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────────── */}
      {launchResult && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-medium">Launch results</h2>

            <div className="mb-4 flex flex-wrap gap-4 text-sm">
              <div>
                <span className="font-semibold text-success">
                  {launchResult.totalAdsCreated}
                </span>
                <span className="ml-1 text-muted-foreground">ads created</span>
              </div>
              {launchResult.totalAdsFailed > 0 && (
                <div>
                  <span className="font-semibold text-destructive">
                    {launchResult.totalAdsFailed}
                  </span>
                  <span className="ml-1 text-muted-foreground">ads failed</span>
                </div>
              )}
              {launchResult.rateLimited && (
                <div className="text-xs text-warning">
                  ⚠ Rate-limited mid-run — retry remaining campaigns in a few
                  minutes.
                </div>
              )}
            </div>

            <ul className="space-y-2">
              {launchResult.campaigns.map((r) => {
                const name =
                  selectedCampaigns.get(r.campaignId)?.name ?? r.campaignId;
                const ok =
                  !r.error &&
                  r.creativesFailed.length === 0 &&
                  r.adsFailed === 0;
                return (
                  <li
                    key={r.campaignId}
                    className={`rounded-md border px-3 py-2.5 text-sm
                      ${ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}
                  >
                    <div className="flex items-start gap-2">
                      {ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{name}</p>
                        {r.error ? (
                          <p className="text-xs text-destructive">{r.error}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {r.adsCreated} ad{r.adsCreated !== 1 ? "s" : ""}{" "}
                            created
                            {r.adsFailed > 0 && `, ${r.adsFailed} failed`}
                            {" · "}
                            {r.adSetsFound} ad set
                            {r.adSetsFound !== 1 ? "s" : ""} targeted
                          </p>
                        )}
                        {r.creativesFailed.map((cf) => (
                          <p
                            key={cf.name}
                            className="text-xs text-destructive"
                          >
                            Creative &ldquo;{cf.name}&rdquo; failed: {cf.error}
                          </p>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleReset}>
              Start another batch
            </Button>
            <Button
              size="sm"
              onClick={() =>
                router.push(`/clients/${clientId}?tab=campaigns`)
              }
            >
              Back to campaigns
            </Button>
          </div>
        </div>
      )}

      {/* ── Resume drafts modal ───────────────────────────────────────────────── */}
      {showDraftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-medium">Saved drafts</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDraftModal(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-80 overflow-y-auto px-5 py-3">
              {draftsLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : draftsList.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No saved drafts yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {draftsList.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(d.updated_at).toLocaleString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleLoadDraft(d.id)}
                      >
                        Resume
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteDraft(d.id)}
                        disabled={deletingDraftId === d.id}
                      >
                        {deletingDraftId === d.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end border-t border-border px-5 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDraftModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Load template modal ───────────────────────────────────────────────── */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-medium">Load template</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTemplateModal(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex max-h-[32rem] divide-x divide-border overflow-hidden">
              {/* Template list */}
              <div className="w-1/2 overflow-y-auto px-4 py-3">
                {templatesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : templatesList.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No saved templates yet. Use &ldquo;Save as template&rdquo;
                    to create one.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {templatesList.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => handlePreviewTemplate(t)}
                          className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors
                            ${
                              selectedTemplate?.id === t.id
                                ? "border-primary bg-primary/5"
                                : "border-border hover:bg-muted/40"
                            }`}
                        >
                          <p className="truncate text-sm font-medium">
                            {t.name}
                          </p>
                          {t.description && (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {t.description}
                            </p>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(t.match_pattern.campaign_name_contains ?? []).map(
                              (term) => (
                                <code
                                  key={term}
                                  className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono"
                                >
                                  campaign:{term}
                                </code>
                              ),
                            )}
                            {(t.match_pattern.ad_set_name_contains ?? []).map(
                              (term) => (
                                <code
                                  key={term}
                                  className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono"
                                >
                                  ad set:{term}
                                </code>
                              ),
                            )}
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Used {t.use_count}× · updated{" "}
                            {new Date(t.updated_at).toLocaleDateString("en-GB")}
                          </p>
                        </button>
                        <div className="mt-1 flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTemplate(t.id);
                            }}
                            disabled={deletingTemplateId === t.id}
                          >
                            {deletingTemplateId === t.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Preview pane */}
              <div className="w-1/2 overflow-y-auto px-4 py-3">
                {!selectedTemplate ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    Select a template to preview the match.
                  </p>
                ) : templatePreviewLoading ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <p>Matching against live campaigns…</p>
                  </div>
                ) : templatePreview ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      {templatePreview.suggestionConfidence === "high" ? (
                        <CheckCircle2 className="h-4 w-4 text-success" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-warning" />
                      )}
                      <p className="text-sm font-medium">
                        {templatePreview.matchedCampaigns.length} campaign
                        {templatePreview.matchedCampaigns.length !== 1
                          ? "s"
                          : ""}{" "}
                        matched
                      </p>
                    </div>

                    {templatePreview.matchedCampaigns.length > 0 ? (
                      <ul className="space-y-1">
                        {templatePreview.matchedCampaigns.map((c) => (
                          <li
                            key={c.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                            <span className="truncate">{c.name || c.id}</span>
                          </li>
                        ))}
                        {templatePreview.matchedCampaigns.length ===
                          BULK_ATTACH_CAP &&
                          templatePreview.matchedCampaignIds.length >
                            BULK_ATTACH_CAP && (
                            <li className="text-xs text-muted-foreground">
                              (capped at {BULK_ATTACH_CAP} — some matches
                              excluded)
                            </li>
                          )}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No live campaigns match the template pattern.
                      </p>
                    )}

                    {templatePreview.unmatchedCampaignPatterns.length > 0 && (
                      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                        Pattern(s) not found in any campaign:{" "}
                        {templatePreview.unmatchedCampaignPatterns.map((p) => (
                          <code
                            key={p}
                            className="mx-0.5 rounded bg-warning/10 px-1 font-mono"
                          >
                            {p}
                          </code>
                        ))}
                      </div>
                    )}

                    {templatePreview.adSetMatchPattern.length > 0 && (
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                        <p className="font-medium">Ad set filter</p>
                        <p className="mt-0.5 text-muted-foreground">
                          At step 1, only ad sets matching{" "}
                          {templatePreview.adSetMatchPattern.map((t) => (
                            <code
                              key={t}
                              className="mx-0.5 rounded bg-muted px-1 font-mono"
                            >
                              {t}
                            </code>
                          ))}{" "}
                          will be pre-selected.
                        </p>
                      </div>
                    )}

                    <p className="text-[11px] text-muted-foreground">
                      You can adjust the selection on step 0 and step 1 before
                      launching.
                    </p>
                  </div>
                ) : (
                  <p className="py-8 text-center text-xs text-destructive">
                    Could not fetch match preview. Check your connection.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTemplateModal(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApplyTemplate}
                disabled={
                  !templatePreview ||
                  templatePreview.matchedCampaigns.length === 0 ||
                  templatePreviewLoading
                }
              >
                Apply
                {templatePreview?.matchedCampaigns.length
                  ? ` (${Math.min(templatePreview.matchedCampaigns.length, BULK_ATTACH_CAP)} campaigns)`
                  : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
