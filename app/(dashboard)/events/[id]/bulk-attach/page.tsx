"use client";

/**
 * /events/[id]/bulk-attach
 *
 * Three-step flow for attaching new creatives to multiple live Meta campaigns:
 *   Step 0 — Select campaigns (multi-select picker, sticky footer)
 *   Step 1 — Upload & configure creatives (stripped-down wizard Creatives step)
 *   Step 2 — Review & launch (Asset × Campaign matrix + launch button)
 *
 * No audiences, budget, or scheduling — those are inherited from the existing
 * ad sets on Meta's side. New ads are created ACTIVE (codebase default since
 * PRs #540/#541).
 *
 * Usage: /events/[id]/bulk-attach?adAccountId=act_xxx
 * The adAccountId is required to fetch live campaigns. If absent, the page
 * shows an input for the user to enter it.
 */

import { useState, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Creatives } from "@/components/steps/creatives";
import { CampaignMultiPicker } from "@/components/bulk-attach/campaign-multi-picker";
import { createDefaultCreative } from "@/lib/campaign-defaults";
import type { AdCreativeDraft, MetaCampaignSummary } from "@/lib/types";
import type { BulkAttachResult } from "@/app/api/meta/bulk-attach-ads/route";

const BULK_ATTACH_CAP = 8;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adAccountId?: string }>;
}

type Step = 0 | 1 | 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const labels = ["Select campaigns", "Configure creatives", "Review & launch"];
  return (
    <ol className="flex items-center gap-0 text-xs">
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
              className={active ? "font-medium text-foreground" : done ? "text-foreground/70" : "text-muted-foreground"}
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

  // ── Ad account (required for campaign picker) ─────────────────────────────
  const [adAccountId, setAdAccountId] = useState(initialAdAccountId ?? "");
  const [adAccountInput, setAdAccountInput] = useState(initialAdAccountId ?? "");

  // ── Step state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(0);

  // Step 0: multi-select campaign selection
  // Set<campaignId> lives here (parent) so it survives Load More pagination.
  const [selectedCampaigns, setSelectedCampaigns] = useState<Map<string, MetaCampaignSummary>>(
    new Map(),
  );

  const handleToggle = useCallback((campaign: MetaCampaignSummary) => {
    setSelectedCampaigns((prev) => {
      const next = new Map(prev);
      if (next.has(campaign.id)) {
        next.delete(campaign.id);
      } else {
        if (next.size >= BULK_ATTACH_CAP) return prev; // hard cap enforced in UI too
        next.set(campaign.id, campaign);
      }
      return next;
    });
  }, []);

  const selectedIds = new Set(selectedCampaigns.keys());

  // Step 1: creatives
  const [creatives, setCreatives] = useState<AdCreativeDraft[]>([createDefaultCreative()]);

  // Step 2: launch state
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<BulkAttachResult | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

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
    try {
      const res = await fetch("/api/meta/bulk-attach-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId,
          metaCampaignIds: Array.from(selectedCampaigns.keys()),
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
        <div className="min-w-0">
          <h1 className="font-heading text-lg tracking-wide">Bulk attach creatives</h1>
          <p className="text-xs text-muted-foreground">
            Upload new assets once, attach across multiple live campaigns.
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <StepIndicator step={step} />

      {/* ── Ad account guard ──────────────────────────────────────────────── */}
      {!adAccountId && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <p className="text-sm font-medium">Enter the Meta ad account ID</p>
          <p className="text-xs text-muted-foreground">
            Format: <code className="rounded bg-muted px-1.5 py-0.5">act_1234567890</code> or just
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
          {/* ── STEP 0: Select campaigns ────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-medium text-sm">Select campaigns</h2>
                  <span className="text-xs text-muted-foreground">
                    Max {BULK_ATTACH_CAP} per batch
                  </span>
                </div>
                <CampaignMultiPicker
                  adAccountId={adAccountId}
                  selectedIds={selectedIds}
                  onToggle={handleToggle}
                />
              </div>

              {/* Sticky footer */}
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

          {/* ── STEP 1: Configure creatives ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-medium text-sm">Configure creatives</h2>
                  <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                  </Button>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Assets are uploaded once and attached to all selected campaigns. No
                  audiences, budget, or scheduling — those come from the existing ad sets.
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
                  onClick={() => setStep(2)}
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

          {/* ── STEP 2: Review & launch ──────────────────────────────────── */}
          {step === 2 && !launchResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-medium text-sm">Review</h2>
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={launching}>
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                  </Button>
                </div>

                {/* Asset × Campaign matrix */}
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
                          {Array.from(selectedCampaigns.keys()).map((cid) => (
                            <td key={cid} className="px-3 py-2 text-muted-foreground">
                              1 creative + ads per ad set
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-muted-foreground">
                  {creatives.length} creative{creatives.length !== 1 ? "s" : ""} ×{" "}
                  {selectedCampaigns.size} campaign{selectedCampaigns.size !== 1 ? "s" : ""}.
                  New ads will be <strong>ACTIVE</strong> immediately.
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

                {/* Summary row */}
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

                {/* Per-campaign breakdown */}
                <ul className="space-y-2">
                  {launchResult.campaigns.map((r) => {
                    const name =
                      selectedCampaigns.get(r.campaignId)?.name ?? r.campaignId;
                    const ok = !r.error && r.creativesFailed.length === 0 && r.adsFailed === 0;
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
                                {r.adSetsFound} ad set{r.adSetsFound !== 1 ? "s" : ""}
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLaunchResult(null);
                    setStep(0);
                    setSelectedCampaigns(new Map());
                    setCreatives([createDefaultCreative()]);
                  }}
                >
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
    </div>
  );
}
