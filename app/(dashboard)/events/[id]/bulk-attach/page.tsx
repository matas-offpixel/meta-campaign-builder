"use client";

/**
 * /events/[id]/bulk-attach
 *
 * Four-step flow for attaching new creatives to explicitly-selected ad sets
 * across multiple live Meta campaigns:
 *
 *   Step 0 — Select campaigns   (multi-select picker)
 *   Step 1 — Select ad sets     (per-campaign ad set picker, all pre-selected)
 *   Step 2 — Configure creatives (stripped-down wizard step)
 *   Step 3 — Review & launch    (Asset × Campaign matrix + actual ad counts)
 *
 * Draft persistence:
 *   - localStorage autosave on every state change (convenience, non-authoritative)
 *   - Explicit "Save draft" → POST /api/bulk-attach-drafts (Supabase, user-scoped RLS)
 *   - "Resume draft" modal on Step 0 lists saved drafts for the event
 *   - On mount: if localStorage has unsaved state, show "Resume previous session?" banner
 *
 * All new ads created ACTIVE (codebase default since PRs #540/#541).
 */

import { useState, useCallback, use, useEffect, useRef } from "react";
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
import type { AdCreativeDraft, MetaCampaignSummary } from "@/lib/types";
import type { BulkAttachResult } from "@/app/api/meta/bulk-attach-ads/route";

const BULK_ATTACH_CAP = 8;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adAccountId?: string }>;
}

type Step = 0 | 1 | 2 | 3;

/** Minimal shape of a saved draft row returned by the API. */
interface DraftListItem {
  id: string;
  name: string;
  updated_at: string;
  event_id: string | null;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const labels = ["Select campaigns", "Select ad sets", "Configure creatives", "Review & launch"];
  return (
    <ol className="flex flex-wrap items-center gap-0 text-xs">
      {labels.map((label, i) => {
        const active = step === i;
        const done = step > i;
        return (
          <li key={i} className="flex items-center gap-1">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold
                ${done ? "bg-primary text-background" : active ? "bg-primary text-background" : "bg-muted text-muted-foreground"}`}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BulkAttachPage({ params, searchParams }: PageProps) {
  const { id: eventId } = use(params);
  const { adAccountId: initialAdAccountId } = use(searchParams);

  const router = useRouter();
  const lsKey = `bulk-attach-unsaved-${eventId}`;

  // ── Ad account ────────────────────────────────────────────────────────────
  const [adAccountId, setAdAccountId] = useState(initialAdAccountId ?? "");
  const [adAccountInput, setAdAccountInput] = useState(initialAdAccountId ?? "");

  // ── Step ──────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(0);

  // ── Step 0: campaign selection ────────────────────────────────────────────
  const [selectedCampaigns, setSelectedCampaigns] = useState<Map<string, MetaCampaignSummary>>(
    new Map(),
  );

  const handleToggleCampaign = useCallback((campaign: MetaCampaignSummary) => {
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
  }, []);

  const selectedIds = new Set(selectedCampaigns.keys());

  // ── Step 1: ad set selection ──────────────────────────────────────────────
  const [campaignAdSets, setCampaignAdSets] = useState<Map<string, Set<string>>>(new Map());

  const allCampaignsHaveAdSets =
    campaignAdSets.size > 0 &&
    Array.from(selectedCampaigns.keys()).every(
      (cid) => (campaignAdSets.get(cid)?.size ?? 0) > 0,
    );

  const adSetValidationError = !allCampaignsHaveAdSets
    ? "Each selected campaign must have at least one ad set selected."
    : null;

  // ── Step 2: creatives ─────────────────────────────────────────────────────
  const [creatives, setCreatives] = useState<AdCreativeDraft[]>([createDefaultCreative()]);

  // ── Step 3: launch ────────────────────────────────────────────────────────
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<BulkAttachResult | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // ── Draft save state ──────────────────────────────────────────────────────
  const [draftId, setDraftId] = useState<string | null>(null);
  const [showNameInput, setShowNameInput] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Resume modal state ────────────────────────────────────────────────────
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [draftsList, setDraftsList] = useState<DraftListItem[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);

  // ── Unsaved-changes banner ────────────────────────────────────────────────
  const [showUnsavedBanner, setShowUnsavedBanner] = useState(false);
  const mountedRef = useRef(false);

  // ── Computed totals ───────────────────────────────────────────────────────
  const totalSelectedAdSets = Array.from(campaignAdSets.values()).reduce(
    (sum, s) => sum + s.size,
    0,
  );
  const totalAdsToCreate = totalSelectedAdSets * creatives.length;

  // ── localStorage autosave ─────────────────────────────────────────────────
  // Runs on every meaningful state change. Not debounced — the serialisation is
  // cheap. Never assume this is authoritative (server draft is the source of truth).
  useEffect(() => {
    if (!mountedRef.current) return; // skip the initial render
    if (!adAccountId) return;
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
      // localStorage may be full or disabled — fail silently
    }
  }, [step, selectedCampaigns, campaignAdSets, creatives, adAccountId, lsKey]);

  // ── Mount: check localStorage for unsaved state ───────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const live = deserialiseDraftState(parsed);
      if (live && hasMeaningfulState(live)) {
        setShowUnsavedBanner(true);
      }
    } catch {
      // ignore corrupt storage
    }
  }, [lsKey]);

  // ── Restore from localStorage ─────────────────────────────────────────────
  const handleRestoreFromLocalStorage = () => {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return;
      const live = deserialiseDraftState(JSON.parse(raw));
      if (!live) return;
      setAdAccountId(live.adAccountId);
      setAdAccountInput(live.adAccountId);
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

  // ── Save draft to Supabase ────────────────────────────────────────────────
  const openSaveNameInput = () => {
    setDraftNameInput(defaultDraftName(eventId));
    setShowNameInput(true);
    setSaveError(null);
  };

  const handleSaveDraft = async () => {
    if (!draftNameInput.trim()) return;
    setSavingDraft(true);
    setSaveError(null);
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
          eventId,
          name: draftNameInput.trim(),
          state,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setDraftId(data.draft.id);
      setShowNameInput(false);
      // Clear localStorage — server is now authoritative
      try { localStorage.removeItem(lsKey); } catch { /**/ }
      // Show "Draft saved" toast for 3 s
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingDraft(false);
    }
  };

  // ── Load drafts list ──────────────────────────────────────────────────────
  const handleOpenResumeModal = async () => {
    setShowResumeModal(true);
    setDraftsLoading(true);
    try {
      const res = await fetch(`/api/bulk-attach-drafts?eventId=${eventId}`);
      const data = await res.json();
      setDraftsList((data.drafts ?? []) as DraftListItem[]);
    } catch {
      setDraftsList([]);
    } finally {
      setDraftsLoading(false);
    }
  };

  // ── Load a specific draft ─────────────────────────────────────────────────
  const handleLoadDraft = async (id: string) => {
    try {
      const res = await fetch(`/api/bulk-attach-drafts/${id}`);
      const data = await res.json();
      if (!res.ok || !data.draft) return;
      const live = deserialiseDraftState(data.draft.state);
      if (!live) return;
      setDraftId(id);
      setAdAccountId(live.adAccountId);
      setAdAccountInput(live.adAccountId);
      setStep(live.step as Step);
      setSelectedCampaigns(live.selectedCampaigns);
      setCampaignAdSets(live.campaignAdSets);
      setCreatives(live.creatives);
      setShowResumeModal(false);
      setShowUnsavedBanner(false);
    } catch {
      // ignore — state unchanged on error
    }
  };

  // ── Delete a draft ────────────────────────────────────────────────────────
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

  // ── Ad account commit ─────────────────────────────────────────────────────
  const commitAdAccount = () => {
    const id = adAccountInput.trim().replace(/^act_/, "");
    if (!id) return;
    setAdAccountId(`act_${id}`);
  };

  // ── Launch ────────────────────────────────────────────────────────────────
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

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setLaunchResult(null);
    setStep(0);
    setSelectedCampaigns(new Map());
    setCampaignAdSets(new Map());
    setCreatives([createDefaultCreative()]);
    setDraftId(null);
    try { localStorage.removeItem(lsKey); } catch { /**/ }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={`/events/${eventId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-lg tracking-wide">Bulk attach creatives</h1>
          <p className="text-xs text-muted-foreground">
            Upload new assets once, attach across multiple live campaigns.
          </p>
        </div>
        {/* Save draft controls */}
        <div className="flex shrink-0 items-center gap-2">
          {savedToast && (
            <span className="text-xs text-success font-medium">Draft saved</span>
          )}
          {!launchResult && (
            <>
              {showNameInput ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={draftNameInput}
                    onChange={(e) => setDraftNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveDraft();
                      if (e.key === "Escape") setShowNameInput(false);
                    }}
                    placeholder="Draft name…"
                    className="w-44 rounded-md border border-border bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button size="sm" onClick={handleSaveDraft} disabled={savingDraft || !draftNameInput.trim()}>
                    {savingDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowNameInput(false)}>
                    <X className="h-3 w-3" />
                  </Button>
                  {saveError && <span className="text-xs text-destructive">{saveError}</span>}
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={openSaveNameInput} disabled={!adAccountId}>
                  <Save className="mr-1 h-3.5 w-3.5" />
                  Save draft
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Unsaved changes banner */}
      {showUnsavedBanner && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <span className="flex-1">You have unsaved changes from a previous session.</span>
          <Button size="sm" variant="outline" onClick={handleRestoreFromLocalStorage}>
            Resume
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowUnsavedBanner(false);
              try { localStorage.removeItem(lsKey); } catch { /**/ }
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Step indicator */}
      <StepIndicator step={step} />

      {/* ── Ad account guard ───────────────────────────────────────────────── */}
      {!adAccountId && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <p className="text-sm font-medium">Enter the Meta ad account ID</p>
          <p className="text-xs text-muted-foreground">
            Format:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">act_1234567890</code> or just
            the numeric part.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={adAccountInput}
              onChange={(e) => setAdAccountInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitAdAccount()}
              placeholder="act_1234567890"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="sm" onClick={commitAdAccount} disabled={!adAccountInput.trim()}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {adAccountId && (
        <>
          {/* ── STEP 0: Select campaigns ─────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-medium text-sm">Select campaigns</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Max {BULK_ATTACH_CAP}</span>
                    <Button variant="ghost" size="sm" onClick={handleOpenResumeModal}>
                      <FolderOpen className="mr-1 h-3.5 w-3.5" />
                      Saved drafts
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
                <div className="sticky bottom-4 rounded-lg border border-primary/30 bg-card px-4 py-3 shadow-lg flex items-center justify-between gap-4">
                  <div className="text-sm">
                    <span className="font-semibold">{selectedCampaigns.size}</span>{" "}
                    <span className="text-muted-foreground">
                      campaign{selectedCampaigns.size !== 1 ? "s" : ""} selected
                    </span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="text-muted-foreground text-xs">
                      {Array.from(selectedCampaigns.values())
                        .map((c) => c.name || c.id)
                        .join(", ")
                        .slice(0, 60)}
                      {Array.from(selectedCampaigns.values()).map((c) => c.name || c.id).join(", ")
                        .length > 60 && "…"}
                    </span>
                  </div>
                  <Button size="sm" onClick={() => setStep(1)}>
                    Continue <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 1: Select ad sets ───────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-medium text-sm">Select ad sets</h2>
                  <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                  </Button>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  New ads will be created in the checked ad sets only. All ad sets are
                  pre-selected — uncheck any you want to skip.
                </p>
                <AdSetPicker
                  adAccountId={adAccountId}
                  campaigns={selectedCampaigns}
                  selection={campaignAdSets}
                  onSelectionChange={setCampaignAdSets}
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

          {/* ── STEP 2: Configure creatives ──────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-medium text-sm">Configure creatives</h2>
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                  </Button>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Assets are uploaded once. No audiences, budget, or scheduling — those come
                  from the existing ad sets.
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

          {/* ── STEP 3: Review & launch ──────────────────────────────────── */}
          {step === 3 && !launchResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-medium text-sm">Review</h2>
                  <Button variant="ghost" size="sm" onClick={() => setStep(2)} disabled={launching}>
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
                          <td className="px-3 py-2 font-medium">{cr.name || "(untitled)"}</td>
                          {Array.from(selectedCampaigns.keys()).map((cid) => {
                            const count = campaignAdSets.get(cid)?.size ?? 0;
                            return (
                              <td key={cid} className="px-3 py-2 text-muted-foreground">
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
                  {selectedCampaigns.size} campaign{selectedCampaigns.size !== 1 ? "s" : ""} ={" "}
                  <strong>{totalAdsToCreate} ad{totalAdsToCreate !== 1 ? "s" : ""}</strong> to be
                  created <strong>ACTIVE</strong>.
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

          {/* ── Results ──────────────────────────────────────────────────── */}
          {launchResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <h2 className="mb-4 font-medium text-sm">Launch results</h2>

                <div className="mb-4 flex flex-wrap gap-4 text-sm">
                  <div>
                    <span className="font-semibold text-success">{launchResult.totalAdsCreated}</span>
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
                    <div className="text-warning text-xs">
                      ⚠ Rate-limited mid-run — retry remaining campaigns in a few minutes.
                    </div>
                  )}
                </div>

                <ul className="space-y-2">
                  {launchResult.campaigns.map((r) => {
                    const name = selectedCampaigns.get(r.campaignId)?.name ?? r.campaignId;
                    const ok =
                      !r.error && r.creativesFailed.length === 0 && r.adsFailed === 0;
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
                                {r.adsCreated} ad{r.adsCreated !== 1 ? "s" : ""} created
                                {r.adsFailed > 0 && `, ${r.adsFailed} failed`}
                                {" · "}
                                {r.adSetsFound} ad set{r.adSetsFound !== 1 ? "s" : ""} targeted
                              </p>
                            )}
                            {r.creativesFailed.map((cf) => (
                              <p key={cf.name} className="text-xs text-destructive">
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

              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={handleReset}>
                  Start another batch
                </Button>
                <Button size="sm" onClick={() => router.push(`/events/${eventId}`)}>
                  Back to event
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Resume drafts modal ───────────────────────────────────────────── */}
      {showResumeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="font-medium text-sm">Saved drafts for this event</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowResumeModal(false)}>
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
                  No saved drafts for this event yet.
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
                        title="Delete draft"
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

            <div className="border-t border-border px-5 py-3 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowResumeModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
