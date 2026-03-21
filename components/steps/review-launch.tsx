"use client";

import { useMemo } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ShieldOff, Zap, Shield } from "lucide-react";
import type { CampaignDraft } from "@/lib/types";
import { validateStep } from "@/lib/validation";
import { MOCK_AD_ACCOUNTS, MOCK_CUSTOM_AUDIENCES, MOCK_SAVED_AUDIENCES, MOCK_FACEBOOK_PAGES } from "@/lib/mock-data";
import { METRIC_LABELS, TIME_WINDOW_LABELS } from "@/lib/optimisation-rules";

interface ReviewLaunchProps {
  draft: CampaignDraft;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

export function ReviewLaunch({ draft }: ReviewLaunchProps) {
  const allValidation = validateStep(7, draft);
  const adAccount = MOCK_AD_ACCOUNTS.find((a) => a.id === draft.settings.adAccountId);
  const enabledSets = draft.adSetSuggestions.filter((s) => s.enabled);
  const bs = draft.budgetSchedule;

  const days = useMemo(() => {
    if (!bs.startDate || !bs.endDate) return 0;
    return Math.ceil(
      (new Date(bs.endDate).getTime() - new Date(bs.startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
  }, [bs.startDate, bs.endDate]);

  const totalDaily = enabledSets.reduce((sum, s) => sum + s.budgetPerDay, 0);
  const totalAds = Object.values(draft.creativeAssignments).reduce((sum, ids) => sum + ids.length, 0);

  const newAdCount = draft.creatives.filter((c) => (c.sourceType ?? "new") === "new").length;
  const postAdCount = draft.creatives.filter((c) => (c.sourceType ?? "new") === "existing_post").length;
  const totalVariations = draft.creatives.reduce(
    (sum, c) => sum + ((c.sourceType ?? "new") === "new" ? (c.assetVariations ?? []).length : 0), 0
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Review & Launch</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review your campaign configuration before launching.
        </p>
      </div>

      {/* Validation */}
      {allValidation.errors.length > 0 ? (
        <Card className="border-warning bg-warning/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <CardTitle className="text-warning">Validation Warnings</CardTitle>
              <ul className="mt-2 space-y-1">
                {allValidation.errors.map((err, i) => (
                  <li key={i} className="text-sm text-warning">• {err}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="border-success bg-success/10">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <span className="text-sm font-medium text-success">All steps validated. Ready to launch.</span>
          </div>
        </Card>
      )}

      {/* Campaign Summary */}
      <Card>
        <CardTitle>Campaign Summary</CardTitle>
        <div className="mt-3 divide-y divide-border">
          <SummaryRow label="Campaign" value={draft.settings.campaignName} />
          <SummaryRow label="Code" value={draft.settings.campaignCode} />
          <SummaryRow label="Objective" value={draft.settings.objective.charAt(0).toUpperCase() + draft.settings.objective.slice(1)} />
          <SummaryRow label="Optimisation" value={draft.settings.optimisationGoal.replace(/_/g, " ")} />
          <SummaryRow label="Ad Account" value={adAccount ? `${adAccount.name} (${adAccount.accountId})` : ""} />
        </div>
      </Card>

      {/* Optimisation Strategy Summary */}
      <Card>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <CardTitle>Optimisation Strategy</CardTitle>
          <Badge variant={draft.optimisationStrategy?.mode === "none" ? "default" : "success"}>
            {draft.optimisationStrategy?.mode === "none"
              ? "Manual"
              : draft.optimisationStrategy?.mode === "benchmarks"
                ? "Benchmark Rules"
                : "Custom Rules"}
          </Badge>
        </div>
        {draft.optimisationStrategy?.mode !== "none" && (draft.optimisationStrategy?.rules ?? []).length > 0 ? (
          <div className="mt-3 space-y-2">
            {(draft.optimisationStrategy?.rules ?? [])
              .filter((r) => r.enabled)
              .map((rule) => (
                <div key={rule.id} className={`rounded-lg border px-3 py-2 ${
                  rule.priority === "primary" ? "border-primary/30" : rule.priority === "secondary" ? "border-warning/20" : "border-border"
                }`}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {rule.priority && (
                      <Badge variant={rule.priority === "primary" ? "primary" : "warning"} className="text-[10px] uppercase tracking-wider">
                        {rule.priority}
                      </Badge>
                    )}
                    <span className="text-sm font-medium">{rule.name}</span>
                    <Badge variant="outline">{METRIC_LABELS[rule.metric]}</Badge>
                    <Badge variant="outline">{TIME_WINDOW_LABELS[rule.timeWindow]}</Badge>
                    {rule.useOverride && rule.campaignTargetValue != null && (
                      <Badge variant="warning" className="text-[10px]">
                        Target: {rule.metric === "roas" ? "" : "£"}{rule.campaignTargetValue}{rule.metric === "roas" ? "×" : ""}
                      </Badge>
                    )}
                  </div>
                  {rule.useOverride && rule.accountBenchmarkValue != null && rule.campaignTargetValue != null && (
                    <p className="text-xs text-warning mb-0.5">
                      Account: {rule.metric === "roas" ? "" : "£"}{rule.accountBenchmarkValue}{rule.metric === "roas" ? "×" : ""} → Campaign: {rule.metric === "roas" ? "" : "£"}{rule.campaignTargetValue}{rule.metric === "roas" ? "×" : ""}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {rule.thresholds.map((t) => (
                      <p key={t.id} className="text-xs text-muted-foreground">{t.label}</p>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {draft.optimisationStrategy?.mode === "none" ? "No automated rules — manual optimisation only." : "No rules configured."}
          </p>
        )}

        {/* Guardrails summary */}
        {draft.optimisationStrategy?.guardrails && draft.optimisationStrategy.mode !== "none" && (() => {
          const g = draft.optimisationStrategy.guardrails;
          const sym = bs.currency === "GBP" ? "£" : bs.currency === "USD" ? "$" : bs.currency === "EUR" ? "€" : bs.currency;
          const behaviourLabel = g.ceilingBehaviour === "stop" ? "Stop increases" : g.ceilingBehaviour === "partial" ? "Partially apply" : "Pause scaling";
          return (
            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Budget Guardrails</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <SummaryRow label="Base budget" value={`${sym}${g.baseCampaignBudget.toLocaleString()}`} />
                <SummaryRow label="Max expansion" value={`${g.maxExpansionPercent}%`} />
                <SummaryRow label="Hard ceiling" value={`${sym}${g.hardBudgetCeiling.toLocaleString()}`} />
                <SummaryRow label="At ceiling" value={behaviourLabel} />
                {g.maxDailyIncreasePercent != null && (
                  <SummaryRow label="Max daily increase" value={`+${g.maxDailyIncreasePercent}%`} />
                )}
                {g.cooldownHours != null && (
                  <SummaryRow label="Cooldown" value={`${g.cooldownHours}h`} />
                )}
              </div>
            </div>
          );
        })()}
      </Card>

      {/* Audience Summary */}
      <Card>
        <CardTitle>Audience Summary</CardTitle>
        <div className="mt-3 space-y-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Page Groups ({draft.audiences.pageGroups.length})</span>
            {draft.audiences.pageGroups.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.pageGroups.map((g) => (
                  <Badge key={g.id} variant="primary">
                    {g.name || "Untitled"} ({g.pageIds.length} pages)
                    {g.customAudienceIds.length > 0 && ` + ${g.customAudienceIds.length} custom`}
                    {g.lookalike && ` · ${g.lookalikeRange} LAL`}
                  </Badge>
                ))}
              </div>
            ) : <p className="mt-1 text-sm text-muted-foreground">None</p>}
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom Audience Groups ({draft.audiences.customAudienceGroups.length})</span>
            {draft.audiences.customAudienceGroups.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.customAudienceGroups.map((g) => (
                  <Badge key={g.id} variant="warning">{g.name || "Untitled"} ({g.audienceIds.length})</Badge>
                ))}
              </div>
            ) : <p className="mt-1 text-sm text-muted-foreground">None</p>}
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved Audiences ({draft.audiences.savedAudiences.audienceIds.length})</span>
            {draft.audiences.savedAudiences.audienceIds.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.savedAudiences.audienceIds.map((id) => {
                  const sa = MOCK_SAVED_AUDIENCES.find((a) => a.id === id);
                  return <Badge key={id} variant="default">{sa?.name ?? id}</Badge>;
                })}
              </div>
            ) : <p className="mt-1 text-sm text-muted-foreground">None</p>}
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interest Groups ({draft.audiences.interestGroups.length})</span>
            {draft.audiences.interestGroups.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.interestGroups.map((g) => (
                  <Badge key={g.id} variant="default">{g.name || "Untitled"} ({g.interests.length} interests)</Badge>
                ))}
              </div>
            ) : <p className="mt-1 text-sm text-muted-foreground">None</p>}
          </div>
        </div>
      </Card>

      {/* Creatives Summary */}
      <Card>
        <div className="flex items-center gap-2">
          <CardTitle>Ads ({draft.creatives.length})</CardTitle>
          {newAdCount > 0 && <Badge variant="primary">{newAdCount} new</Badge>}
          {postAdCount > 0 && <Badge variant="warning">{postAdCount} existing post</Badge>}
          {totalVariations > 0 && <Badge variant="outline">{totalVariations} asset variations</Badge>}
        </div>
        {draft.creatives.length > 0 ? (
          <div className="mt-3 space-y-2">
            {draft.creatives.map((c, i) => {
              const page = MOCK_FACEBOOK_PAGES.find((p) => p.id === c.identity?.pageId);
              const varCount = (c.sourceType ?? "new") === "new" ? (c.assetVariations ?? []).length : 0;
              const captionCount = (c.captions ?? []).length;
              return (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                    <span className="text-sm font-medium">{c.name || "Untitled"}</span>
                    {page && <span className="text-xs text-muted-foreground">· {page.name}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={(c.sourceType ?? "new") === "existing_post" ? "warning" : "primary"}>
                      {(c.sourceType ?? "new") === "existing_post" ? "post" : (c.assetMode ?? "dual")}
                    </Badge>
                    {(c.sourceType ?? "new") === "new" && (
                      <>
                        <Badge variant="outline">{varCount} var</Badge>
                        {captionCount > 1 && <Badge variant="outline">{captionCount} captions</Badge>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <p className="mt-3 text-sm text-muted-foreground">No ads added.</p>}

        {/* Enhancements policy */}
        <div className="mt-3 flex items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2">
          <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">All Meta AI creative enhancements are OFF</span>
        </div>
      </Card>

      {/* Budget Breakdown */}
      <Card>
        <CardTitle>Budget & Schedule</CardTitle>
        <div className="mt-3 divide-y divide-border">
          <SummaryRow label="Budget Type" value={`${bs.budgetType === "daily" ? "Daily" : "Lifetime"} · ${bs.budgetLevel === "ad_set" ? "Ad Set Level" : "CBO"}`} />
          <SummaryRow label="Daily Total" value={`${bs.currency} ${totalDaily.toFixed(2)}/day`} />
          <SummaryRow label="Duration" value={days > 0 ? `${days} days` : "—"} />
          <SummaryRow label="Total Estimated Spend" value={days > 0 ? `${bs.currency} ${(totalDaily * days).toFixed(2)}` : "—"} />
        </div>
        {enabledSets.length > 0 && (
          <div className="mt-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per Ad Set</span>
            <div className="mt-1 space-y-1">
              {enabledSets.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span>{s.name}</span>
                  <span className="font-medium">{bs.currency} {s.budgetPerDay.toFixed(2)}/day</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Assignment Summary */}
      <Card>
        <CardTitle>Assignment Summary</CardTitle>
        <div className="mt-3 divide-y divide-border">
          <SummaryRow label="Ad Sets" value={String(enabledSets.length)} />
          <SummaryRow label="Ads" value={String(draft.creatives.length)} />
          <SummaryRow label="Total Assigned" value={String(totalAds)} />
        </div>
      </Card>
    </div>
  );
}
