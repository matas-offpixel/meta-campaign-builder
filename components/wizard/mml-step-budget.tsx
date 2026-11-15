"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";

import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getTikTokDraft, upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { loadTikTokBenchmarkRows } from "@/lib/plan/launch-reads";
import { tikTokBenchmarkCost } from "@/lib/plan/benchmarks";
import {
  formatTikTokAdGroupReviewLine,
  parseOptionalMoney,
  tikTokResultLabel,
} from "@/lib/tiktok-wizard/budget-schedule";
import { applyPlanBudgetToGoogle } from "@/lib/plan/adapters/google";
import { applyTikTokAdGroupPlan } from "@/lib/plan/adapters/tiktok";
import { PLAN_BUDGET_PRESETS, presetChipCopy } from "@/lib/plan/budget-split";
import type { PlanEventOption } from "@/lib/plan/event-picker";
import { venueCityToken } from "@/lib/plan/mml-wizard";
import {
  TIKTOK_MIN_ADGROUP_DAILY_GBP,
  TIKTOK_MIN_CAMPAIGN_DAILY_GBP,
  applyDisplayedPreset,
  channelDisplayAmount,
  displayTotal,
  distributeMetaAdSetBudgets,
  editDisplayedShare,
  editSharePercent,
  formatGbp,
  mmlBudgetBlockers,
  mmlBudgetDays,
  planTikTokAdGroups,
  raiseTikTokToMinimum,
  setDisplayedTotal,
  tikTokGroupLines,
  turnChannelOff,
  type MmlBudgetMode,
} from "@/lib/plan/mml-budget";
import type { MmlChannelSelection } from "@/lib/plan/mml-wizard";
import type { CampaignPlan, CampaignPlanBudgetSplit, PlanAdapterName } from "@/lib/plan/types";
import type { BudgetScheduleSettings, LocationTargetingGroup } from "@/lib/types";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";
import { createClient } from "@/lib/supabase/client";
import { useGoogleSearchTree } from "@/lib/wizard/use-google-search-tree";

export interface MmlBudgetController {
  observeSchedule: (prev: BudgetScheduleSettings, next: BudgetScheduleSettings) => void;
}

const ORDER: PlanAdapterName[] = ["meta", "tiktok", "google"];
const LABEL: Record<PlanAdapterName, string> = { meta: "Meta", tiktok: "TikTok", google: "Google" };
const TONE: Record<PlanAdapterName, string> = {
  meta: "bg-foreground",
  tiktok: "bg-foreground/70",
  google: "bg-foreground/40",
};

function dateOnly(value: string | null | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? "");
  return match ? match[1] : null;
}

function timeOf(value: string | null | undefined): string | null {
  const match = /T(\d{2}):(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}:${match[2]}` : null;
}

function venueLabel(venueName: string | null | undefined): string {
  const token = venueCityToken(venueName);
  if (!token) return "venue";
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function locationLabels(groups: LocationTargetingGroup[] | undefined): string[] {
  const labels: string[] = [];
  for (const group of groups ?? []) {
    for (const selection of group.selections) {
      if (selection.mode === "exclude") continue;
      const label = selection.label.trim();
      if (label) labels.push(label);
    }
  }
  return labels;
}

function samePence(left: CampaignPlanBudgetSplit, right: CampaignPlanBudgetSplit): boolean {
  const keys = ["totalDaily", "metaDaily", "tiktokDaily", "googleDaily"] as const;
  return keys.every((key) => Math.round(left[key] * 100) === Math.round(right[key] * 100));
}

function percentText(amount: number, total: number): string {
  if (!(total > 0)) return "0";
  const rounded = Math.round((amount / total) * 1000) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function MmlBudgetReview({
  budget,
  channels,
  mode,
  startDate,
  endDate,
  venueName,
  tiktokDraftId,
  objectiveIntent,
}: {
  budget: CampaignPlanBudgetSplit;
  channels: MmlChannelSelection;
  mode: MmlBudgetMode;
  startDate: string | null;
  endDate: string | null;
  venueName: string | null;
  tiktokDraftId?: string | null;
  objectiveIntent?: string | null;
}) {
  const days = mmlBudgetDays(dateOnly(startDate), dateOnly(endDate));
  const lifetime = mode === "lifetime" && Boolean(days);
  const unit = lifetime ? "run" : "day";
  const share = (daily: number) => (lifetime ? channelDisplayAmount(daily, "lifetime", days) : daily);
  const venue = venueLabel(venueName);
  const tiktok =
    channels.tiktok && budget.tiktokDaily > 0
      ? planTikTokAdGroups({
          share: channelDisplayAmount(budget.tiktokDaily, mode, days),
          mode,
          days,
          venueLabel: venue,
        })
      : null;
  const [targetCost, setTargetCost] = useState<number | null>(null);
  useEffect(() => {
    if (!tiktokDraftId) return;
    let cancelled = false;
    void getTikTokDraft(createClient(), tiktokDraftId).then((loaded) => {
      if (cancelled) return;
      setTargetCost(loaded?.optimisation.targetCostPerResult ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [tiktokDraftId]);
  const resultLabel = tikTokResultLabel({ objective: objectiveIntent });
  const lines =
    tiktok && !tiktok.blocked
      ? tiktok.groups.map((group, index) => {
          const daily =
            lifetime && days && days > 0 ? Math.round((group.amount / days) * 100) / 100 : group.amount;
          return formatTikTokAdGroupReviewLine({
            index: index + 1,
            dailyAmount: daily,
            targetCost,
            resultLabel,
          });
        })
      : tiktok
        ? tikTokGroupLines(tiktok, mode, days)
        : [];
  const dailyKey = { meta: "metaDaily", tiktok: "tiktokDaily", google: "googleDaily" } as const;

  return (
    <Card data-mml-budget-review="">
      <CardTitle>Budget</CardTitle>
      <ul className="mt-4 space-y-1 text-sm text-foreground">
        <li>
          Total {formatGbp(share(budget.totalDaily))}/{unit}
        </li>
        {ORDER.filter((name) => channels[name]).map((name) => (
          <li key={name}>
            {LABEL[name]} {formatGbp(share(budget[dailyKey[name]]))}/{unit}
          </li>
        ))}
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Card>
  );
}

export function MmlStepBudget({
  plan,
  channels,
  onChannels,
  onPatchIntent,
  onBlockers,
  events,
  tiktokDraftId,
  googleDraftId,
  onApplyDraft,
  budgetSchedule,
  controllerRef,
}: {
  plan: CampaignPlan;
  channels: MmlChannelSelection;
  onChannels: (next: MmlChannelSelection) => void;
  onPatchIntent: (patch: Partial<CampaignPlan["intent"]>) => void;
  onBlockers: (errors: string[]) => void;
  events: PlanEventOption[];
  tiktokDraftId: string | null;
  googleDraftId: string | null;
  onApplyDraft:
    | ((updater: (draft: import("@/lib/types").CampaignDraft) => import("@/lib/types").CampaignDraft) => void)
    | null;
  budgetSchedule: BudgetScheduleSettings | null;
  controllerRef: MutableRefObject<MmlBudgetController | null>;
}) {
  const venue = venueLabel(events.find((event) => event.id === plan.intent.eventId)?.venueName);
  const mode: MmlBudgetMode = budgetSchedule?.budgetType === "lifetime" ? "lifetime" : "daily";
  const start = dateOnly(budgetSchedule?.startDate) ?? dateOnly(plan.intent.startDate);
  const end = dateOnly(budgetSchedule?.endDate) ?? dateOnly(plan.intent.endDate);
  const days = mmlBudgetDays(start, end);
  const budget = plan.intent.budget;
  const shownTotal = mode === "lifetime" && !days ? budget.totalDaily : displayTotal(budget, mode, days);
  const lifetimeNeedsDates = mode === "lifetime" && !days;
  const blockers = mmlBudgetBlockers({
    budget,
    selected: channels,
    mode,
    startDate: start,
    endDate: end,
    venueLabel: venue,
  });
  const blockerKey = blockers.join("\n");
  const tiktokPlan = channels.tiktok
    ? planTikTokAdGroups({
        share: channelDisplayAmount(budget.tiktokDaily, mode, days),
        mode,
        days,
        venueLabel: venue,
      })
    : null;
  const [targetDraft, setTargetDraft] = useState("");
  const [targetCost, setTargetCost] = useState<number | null>(null);
  const [targetReady, setTargetReady] = useState(false);
  const [benchmarkHint, setBenchmarkHint] = useState<string | null>(null);
  const event = events.find((row) => row.id === plan.intent.eventId);
  useEffect(() => {
    if (!tiktokDraftId) return;
    let cancelled = false;
    void getTikTokDraft(createClient(), tiktokDraftId).then((loaded) => {
      if (cancelled || !loaded) return;
      const value = loaded.optimisation.targetCostPerResult;
      setTargetCost(value);
      setTargetDraft(value == null ? "" : String(value));
      setTargetReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tiktokDraftId]);
  useEffect(() => {
    if (!event?.clientId) return;
    let cancelled = false;
    const unit = plan.intent.target.unit ?? (plan.intent.objectiveIntent === "traffic" ? "click" : plan.intent.objectiveIntent === "purchase" ? "purchase" : null);
    void loadTikTokBenchmarkRows(createClient(), event.clientId).then((rows) => {
      if (cancelled) return;
      const cost = tikTokBenchmarkCost(rows, { clientId: event.clientId!, unit });
      setBenchmarkHint(cost == null ? null : `Usual TikTok cost per result ${formatGbp(cost)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [event?.clientId, plan.intent.objectiveIntent, plan.intent.target.unit]);

  const googleRef = useRef<{ apply: (updater: (tree: GoogleSearchPlanTree) => GoogleSearchPlanTree) => void } | null>(
    null,
  );
  const tiktokTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTikTok = useRef<(() => void) | null>(null);
  const aligned = useRef(false);

  useEffect(() => {
    onBlockers(blockerKey ? blockerKey.split("\n") : []);
  }, [blockerKey, onBlockers]);

  useEffect(() => {
    if (aligned.current || !onApplyDraft || !budgetSchedule) return;
    if (!(budget.metaDaily > 0)) return;
    aligned.current = true;
    const amount = channelDisplayAmount(budget.metaDaily, mode, days);
    if (Math.round(amount * 100) === Math.round(budgetSchedule.budgetAmount * 100)) return;
    const level = budgetSchedule.budgetLevel;
    onApplyDraft((draft) => ({
      ...draft,
      budgetSchedule: { ...draft.budgetSchedule, budgetAmount: amount },
      adSetSuggestions: distributeMetaAdSetBudgets(draft.adSetSuggestions, amount, mode, level),
    }));
  }, [budget.metaDaily, budgetSchedule, days, mode, onApplyDraft]);

  function pushMeta(next: CampaignPlanBudgetSplit, nextMode: MmlBudgetMode, nextDays: number | null) {
    if (!onApplyDraft || !budgetSchedule) return;
    const amount = channelDisplayAmount(next.metaDaily, nextMode, nextDays);
    const level = budgetSchedule.budgetLevel;
    onApplyDraft((draft) => ({
      ...draft,
      budgetSchedule: { ...draft.budgetSchedule, budgetAmount: amount },
      adSetSuggestions: distributeMetaAdSetBudgets(draft.adSetSuggestions, amount, nextMode, level),
    }));
  }

  function writeOutlets(
    next: CampaignPlanBudgetSplit,
    selected: MmlChannelSelection,
    nextStart: string | null,
    nextEnd: string | null,
    nextMode: MmlBudgetMode,
    labels: string[],
    targetOverride?: number | null,
  ) {
    const nextTarget =
      targetOverride === undefined ? (targetReady ? targetCost : undefined) : targetOverride;
    const nextDays = mmlBudgetDays(nextStart, nextEnd);
    if (selected.google && googleDraftId) {
      googleRef.current?.apply((tree) =>
        applyPlanBudgetToGoogle(tree, {
          googleDaily: next.googleDaily,
          startDate: nextStart,
          endDate: nextEnd,
          locationLabels: labels,
        }),
      );
    }
    if (!selected.tiktok || !tiktokDraftId) return;
    const share = channelDisplayAmount(next.tiktokDaily, nextMode, nextDays);
    const planned = planTikTokAdGroups({
      share,
      mode: nextMode,
      days: nextDays,
      venueLabel: venue,
    });
    if (planned.blocked) return;
    pendingTikTok.current = () => {
      void (async () => {
        const supabase = createClient();
        const loaded = await getTikTokDraft(supabase, tiktokDraftId);
        if (!loaded) return;
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return;
        const applied = applyTikTokAdGroupPlan(loaded, {
          mode: nextMode === "lifetime" ? "LIFETIME" : "DAILY",
          dailyAmount: next.tiktokDaily,
          groups: planned.groups,
          startDate: nextStart,
          endDate: nextEnd,
          startTime: timeOf(budgetSchedule?.startDate) ?? plan.intent.startTime,
          endTime: timeOf(budgetSchedule?.endDate) ?? plan.intent.endTime,
          targetCostPerResult: nextTarget,
        });
        await upsertTikTokDraft(supabase, applied.id, { ...applied, userId: auth.user.id });
      })();
    };
    if (tiktokTimer.current) clearTimeout(tiktokTimer.current);
    tiktokTimer.current = setTimeout(() => {
      pendingTikTok.current?.();
      pendingTikTok.current = null;
    }, 400);
  }

  function commit(next: CampaignPlanBudgetSplit, nextChannels?: MmlChannelSelection) {
    const selected = nextChannels ?? channels;
    if (nextChannels) onChannels(nextChannels);
    const patch: Partial<CampaignPlan["intent"]> = { budget: next };
    if (start !== dateOnly(plan.intent.startDate)) patch.startDate = start;
    if (end !== dateOnly(plan.intent.endDate)) patch.endDate = end;
    const startTime = timeOf(budgetSchedule?.startDate);
    const endTime = timeOf(budgetSchedule?.endDate);
    if (startTime) patch.startTime = startTime;
    if (endTime) patch.endTime = endTime;
    onPatchIntent(patch);
    pushMeta(next, mode, days);
    writeOutlets(next, selected, start, end, mode, locationLabels(budgetSchedule?.locationGroups));
  }

  useEffect(() => {
    controllerRef.current = {
      observeSchedule(prev, nextSchedule) {
        const nextMode: MmlBudgetMode = nextSchedule.budgetType === "lifetime" ? "lifetime" : "daily";
        const nextStart = dateOnly(nextSchedule.startDate);
        const nextEnd = dateOnly(nextSchedule.endDate);
        const nextDays = mmlBudgetDays(nextStart, nextEnd);
      let nextBudget = budget;
      const patch: Partial<CampaignPlan["intent"]> = {};
      if (nextSchedule.budgetAmount !== prev.budgetAmount) {
        nextBudget = editDisplayedShare(budget, channels, "meta", nextSchedule.budgetAmount, nextMode, nextDays);
        patch.budget = nextBudget;
        const clamped = channelDisplayAmount(nextBudget.metaDaily, nextMode, nextDays);
        if (onApplyDraft && Math.round(clamped * 100) !== Math.round(nextSchedule.budgetAmount * 100)) {
          const level = nextSchedule.budgetLevel;
          onApplyDraft((draft) => ({
            ...draft,
            budgetSchedule: { ...draft.budgetSchedule, budgetAmount: clamped },
            adSetSuggestions: distributeMetaAdSetBudgets(draft.adSetSuggestions, clamped, nextMode, level),
          }));
        }
      }
      if (nextStart !== dateOnly(plan.intent.startDate)) patch.startDate = nextStart;
      if (nextEnd !== dateOnly(plan.intent.endDate)) patch.endDate = nextEnd;
      const startTime = timeOf(nextSchedule.startDate);
      const endTime = timeOf(nextSchedule.endDate);
      if (startTime && startTime !== plan.intent.startTime) patch.startTime = startTime;
      if (endTime && endTime !== plan.intent.endTime) patch.endTime = endTime;
      if (Object.keys(patch).length > 0) onPatchIntent(patch);
      if (nextSchedule.budgetType !== prev.budgetType && onApplyDraft) {
        const amount = channelDisplayAmount(nextBudget.metaDaily, nextMode, nextDays);
        const level = nextSchedule.budgetLevel;
        onApplyDraft((draft) => ({
          ...draft,
          budgetSchedule: { ...draft.budgetSchedule, budgetAmount: amount },
          adSetSuggestions: distributeMetaAdSetBudgets(draft.adSetSuggestions, amount, nextMode, level),
        }));
      }
        writeOutlets(
          nextBudget,
          channels,
          nextStart,
          nextEnd,
          nextMode,
          locationLabels(nextSchedule.locationGroups),
        );
      },
    };
  });

  useEffect(() => {
    return () => {
      if (tiktokTimer.current) clearTimeout(tiktokTimer.current);
      pendingTikTok.current?.();
      pendingTikTok.current = null;
    };
  }, []);

  const active = ORDER.filter((name) => channels[name]);
  const amounts = active.map((name) => ({
    name,
    amount: channelDisplayAmount(
      budget[name === "meta" ? "metaDaily" : name === "tiktok" ? "tiktokDaily" : "googleDaily"],
      mode,
      days,
    ),
  }));
  const barTotal = amounts.reduce((sum, row) => sum + row.amount, 0);

  function onBoundary(index: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (lifetimeNeedsDates) return;
    const bar = event.currentTarget.parentElement;
    if (!bar) return;
    const move = (ev: PointerEvent) => {
      const rect = bar.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)) : 0;
      const before = amounts.slice(0, index).reduce((sum, row) => sum + row.amount, 0);
      const next = Math.round((barTotal * ratio - before) * 100) / 100;
      commit(editDisplayedShare(budget, channels, amounts[index]!.name, Math.max(0, next), mode, days));
    };
    const up = (ev: PointerEvent) => {
      move(ev);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="space-y-4" data-mml-budget="">
      {googleDraftId ? <GoogleBudgetBridge planId={googleDraftId} bridgeRef={googleRef} /> : null}
      <Card>
        <CardTitle>Budget split</CardTitle>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {PLAN_BUDGET_PRESETS.map((preset) => {
              const applied = applyDisplayedPreset(budget, preset.id, channels);
              const on = samePence(applied, budget) && budget.totalDaily > 0;
              const copy = presetChipCopy(preset, channels, on);
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={copy.title}
                  onClick={() => commit(applied)}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                    on ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"
                  }`}
                >
                  {copy.label}
                </button>
              );
            })}
          </div>
          <Input
            id="mml-total"
            label={mode === "lifetime" ? "Total for the run (£)" : "Total per day (£)"}
            type="number"
            min={0}
            step="0.01"
            value={lifetimeNeedsDates ? "" : shownTotal}
            placeholder={lifetimeNeedsDates ? "Set the end date" : undefined}
            disabled={lifetimeNeedsDates}
            onChange={(event) => {
              const raw = event.target.value;
              const parsed = raw.trim() === "" ? 0 : Number(raw);
              if (!Number.isFinite(parsed)) return;
              commit(setDisplayedTotal(budget, channels, mode, days, Math.max(0, parsed)));
            }}
          />
          <div className="relative flex h-10 overflow-hidden rounded-md border border-border" aria-label="Budget split">
            {amounts.map((row) => (
              <div
                key={row.name}
                className={`${TONE[row.name]} h-full`}
                style={{ width: barTotal > 0 ? `${(row.amount / barTotal) * 100}%` : `${100 / Math.max(1, amounts.length)}%` }}
              />
            ))}
            {amounts.slice(0, -1).map((row, index) => {
              const left = amounts.slice(0, index + 1).reduce((sum, item) => sum + item.amount, 0);
              return (
                <button
                  key={`handle-${row.name}`}
                  type="button"
                  aria-label={`Drag ${LABEL[row.name]} share`}
                  onPointerDown={(event) => onBoundary(index, event)}
                  className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-col-resize"
                  style={{ left: barTotal > 0 ? `${(left / barTotal) * 100}%` : "0%" }}
                />
              );
            })}
          </div>
          <div className="space-y-3">
            {amounts.map((row) => (
              <div key={row.name} className="grid grid-cols-[6rem_1fr_6rem] items-end gap-3">
                <span className="pb-2 text-sm font-medium text-foreground">{LABEL[row.name]}</span>
                <Input
                  id={`mml-${row.name}-pounds`}
                  label="£"
                  type="number"
                  min={0}
                  step="0.01"
                  value={row.amount}
                  disabled={lifetimeNeedsDates}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (!Number.isFinite(parsed)) return;
                    commit(editDisplayedShare(budget, channels, row.name, Math.max(0, parsed), mode, days));
                  }}
                />
                <Input
                  id={`mml-${row.name}-percent`}
                  label="%"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={percentText(row.amount, barTotal)}
                  disabled={lifetimeNeedsDates || !(barTotal > 0)}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (!Number.isFinite(parsed)) return;
                    commit(editSharePercent(budget, channels, row.name, Math.max(0, parsed)));
                  }}
                />
              </div>
            ))}
          </div>
          {tiktokPlan && budget.tiktokDaily > 0 ? (
            <div className="space-y-2">
              {tikTokGroupLines(tiktokPlan, mode, days).map((line) => (
                <p key={line} className="text-sm text-foreground">
                  {line}
                </p>
              ))}
              {budget.tiktokDaily >= TIKTOK_MIN_CAMPAIGN_DAILY_GBP ? (
                <p className="text-sm text-muted-foreground">
                  Campaign budget {formatGbp(channelDisplayAmount(budget.tiktokDaily, mode, days))}/
                  {mode === "lifetime" ? "run" : "day"}
                </p>
              ) : tiktokPlan && !tiktokPlan.blocked ? (
                <p className="text-sm text-muted-foreground">
                  Campaign budget left unset. TikTok&apos;s £50 campaign minimum applies only when a campaign budget is set.
                </p>
              ) : null}
              <div className="max-w-xs space-y-1">
                <Input
                  id="mml-tiktok-target-cost"
                  label="Target cost per result (£)"
                  type="text"
                  inputMode="decimal"
                  value={targetDraft}
                  placeholder="Lowest cost"
                  onChange={(event) => setTargetDraft(event.target.value)}
                  onBlur={() => {
                    try {
                      const parsed = parseOptionalMoney(targetDraft);
                      setTargetCost(parsed);
                      setTargetDraft(parsed == null ? "" : String(parsed));
                      writeOutlets(
                        budget,
                        channels,
                        start,
                        end,
                        mode,
                        locationLabels(budgetSchedule?.locationGroups),
                        parsed,
                      );
                    } catch {
                      setTargetDraft(targetCost == null ? "" : String(targetCost));
                    }
                  }}
                />
                {benchmarkHint ? (
                  <p className="text-xs text-muted-foreground">{benchmarkHint}</p>
                ) : null}
              </div>
              {tiktokPlan.blocked ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-foreground bg-foreground px-4 py-2 text-sm font-medium text-background"
                    onClick={() => commit(raiseTikTokToMinimum(budget, channels))}
                  >
                    Raise TikTok to {formatGbp(TIKTOK_MIN_ADGROUP_DAILY_GBP)}/day
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border-strong px-4 py-2 text-sm font-medium hover:bg-card"
                    onClick={() => {
                      const off = turnChannelOff(budget, channels, "tiktok");
                      commit(off.budget, off.selected);
                    }}
                  >
                    Turn TikTok off
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function GoogleBudgetBridge({
  planId,
  bridgeRef,
}: {
  planId: string;
  bridgeRef: MutableRefObject<{
    apply: (updater: (tree: GoogleSearchPlanTree) => GoogleSearchPlanTree) => void;
  } | null>;
}) {
  const google = useGoogleSearchTree(planId);
  const pending = useRef<((tree: GoogleSearchPlanTree) => GoogleSearchPlanTree) | null>(null);
  const tree = google.tree;
  const onChange = google.onChange;
  const flushRef = useRef(google.flush);

  useEffect(() => {
    flushRef.current = google.flush;
    bridgeRef.current = {
      apply(updater) {
        if (!tree) {
          pending.current = updater;
          return;
        }
        onChange(updater(tree));
      },
    };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, google.flush, onChange, tree]);

  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, []);

  useEffect(() => {
    if (!tree || !pending.current) return;
    const updater = pending.current;
    pending.current = null;
    onChange(updater(tree));
  }, [onChange, tree]);

  return null;
}
