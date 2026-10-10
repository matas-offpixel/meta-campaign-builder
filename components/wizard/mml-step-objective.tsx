"use client";

import { useEffect, useRef } from "react";
import { CircleHelp, Eye, MessageSquare, MousePointerClick, ShoppingCart, Target } from "lucide-react";

import { Card, CardTitle } from "@/components/ui/card";
import { getTikTokDraft, upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { metaObjectiveForIntent } from "@/lib/plan/adapters/meta";
import {
  MML_OBJECTIVE_CARDS,
  eventObjectiveDefault,
  tikTokForPlanIntent,
} from "@/lib/plan/mml-wizard";
import type { CampaignPlan, CampaignPlanObjectiveIntent } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/client";
import { OPTIMISATION_GOALS_BY_OBJECTIVE } from "@/lib/mock-data";
import {
  TIKTOK_OBJECTIVE_LABELS,
  TIKTOK_OPTIMISATION_GOAL_LABELS,
  TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE,
  tikTokObjectivePickerValues,
  tikTokOptimisationGoalLabel,
} from "@/lib/tiktok-wizard/campaign-setup";
import type { CampaignDraft, OptimisationGoal } from "@/lib/types";
import type { TikTokObjective, TikTokOptimisationGoal } from "@/lib/types/tiktok-draft";
import type { MmlChannelSelection } from "@/lib/plan/mml-wizard";

const ICONS = {
  purchase: ShoppingCart,
  registration: Target,
  traffic: MousePointerClick,
  awareness: Eye,
  engagement: MessageSquare,
} as const;

/**
 * One card sets Meta, TikTok and the plan. Google stays Search.
 * Per-channel overrides stay inside the collapsed details.
 */
export function MmlStepObjective({
  plan,
  draft,
  channels,
  tiktokDraftId,
  onPatchIntent,
  onApplyDraft,
}: {
  plan: CampaignPlan;
  draft: CampaignDraft | null;
  channels: MmlChannelSelection;
  tiktokDraftId: string | null;
  onPatchIntent: (patch: Partial<CampaignPlan["intent"]>) => void;
  onApplyDraft: (updater: (draft: CampaignDraft) => CampaignDraft) => void;
}) {
  const intent = plan.intent.objectiveIntent;
  const tiktokMapped = tikTokForPlanIntent(intent);
  const applied = useRef(false);

  useEffect(() => {
    if (!draft || draft.settings.mmlObjectiveChosen || applied.current) return;
    applied.current = true;
    const eventDefault = eventObjectiveDefault(plan.phase);
    choose(eventDefault.intent);
    // The event default is applied once. A later card click sets the same flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, plan.phase]);

  function choose(next: CampaignPlanObjectiveIntent) {
    const mapped = metaObjectiveForIntent(next);
    const cta = next === "purchase" ? "book_now" : next === "registration" ? "sign_up" : null;
    onPatchIntent({ objectiveIntent: next });
    if (draft) {
      onApplyDraft((current) => ({
        ...current,
        settings: {
          ...current.settings,
          objective: mapped.objective,
          optimisationGoal: mapped.optimisationGoal,
          mmlObjectiveChosen: true,
        },
        creatives: cta ? current.creatives.map((creative) => ({ ...creative, cta })) : current.creatives,
      }));
    }
    const tiktok = tikTokForPlanIntent(next);
    if (tiktok && channels.tiktok) void writeTikTok(tiktok.objective, tiktok.goal);
  }

  function writeGoal(goal: OptimisationGoal) {
    if (!draft) return;
    onApplyDraft((current) => ({
      ...current,
      settings: { ...current.settings, optimisationGoal: goal, mmlObjectiveChosen: true },
    }));
  }

  async function writeTikTok(objective: TikTokObjective, goal: TikTokOptimisationGoal | null) {
    if (!tiktokDraftId) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const current = await getTikTokDraft(supabase, tiktokDraftId);
    if (!current) return;
    await upsertTikTokDraft(supabase, tiktokDraftId, {
      ...current,
      userId: user.id,
      campaignSetup: {
        ...current.campaignSetup,
        objective,
        optimisationGoal: goal,
      },
    });
  }

  const goals = draft ? OPTIMISATION_GOALS_BY_OBJECTIVE[draft.settings.objective] ?? [] : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardTitle>Campaign Objective</CardTitle>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {MML_OBJECTIVE_CARDS.map((card) => {
            const Icon = ICONS[card.intent];
            const selected = intent === card.intent;
            return (
              <button
                key={card.intent}
                type="button"
                data-mml-objective={card.intent}
                data-selected={selected ? "true" : "false"}
                onClick={() => choose(card.intent)}
                className={`flex flex-col items-center gap-2 rounded-md border p-4 text-center transition-all ${
                  selected
                    ? "border-foreground/20 bg-card"
                    : "border-transparent hover:border-border-strong hover:bg-card/60"
                }`}
              >
                <Icon className={`h-5 w-5 ${selected ? "text-foreground" : "text-muted-foreground"}`} />
                <span className="text-sm font-medium">{card.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">{card.sublabel}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {channels.tiktok && !tiktokMapped ? (
        <Card>
          <CardTitle>TikTok</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            {intent === "awareness"
              ? "Awareness is not a TikTok campaign objective."
              : "This objective has no TikTok equivalent."}{" "}
            TikTok keeps its own objective.
          </p>
          <TikTokObjectivePicker onPick={(objective, goal) => void writeTikTok(objective, goal)} />
        </Card>
      ) : null}

      <details className="rounded-md border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-3 text-sm font-medium">
          details
          <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {channels.meta && draft ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Meta optimisation goal</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {goals.map((goal) => (
                  <button
                    key={goal.value}
                    type="button"
                    onClick={() => writeGoal(goal.value)}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      draft.settings.optimisationGoal === goal.value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border-strong"
                    }`}
                  >
                    {goal.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {channels.tiktok && tiktokMapped ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                TikTok · {TIKTOK_OBJECTIVE_LABELS[tiktokMapped.objective]} ·{" "}
                {tikTokOptimisationGoalLabel(tiktokMapped.goal, tiktokMapped.objective)}
              </p>
              <TikTokObjectivePicker onPick={(objective, goal) => void writeTikTok(objective, goal)} />
            </div>
          ) : null}
          {channels.google ? (
            <p className="text-sm text-muted-foreground">Google · Search</p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function TikTokObjectivePicker({
  onPick,
}: {
  onPick: (objective: TikTokObjective, goal: TikTokOptimisationGoal | null) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {tikTokObjectivePickerValues(null).map((objective) => (
        <button
          key={objective}
          type="button"
          onClick={() => onPick(objective, TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE[objective][0] ?? null)}
          className="rounded-md border border-border-strong px-3 py-1.5 text-sm"
        >
          {TIKTOK_OBJECTIVE_LABELS[objective]}
          <span className="ml-1 text-[11px] text-muted-foreground">
            {TIKTOK_OPTIMISATION_GOAL_LABELS[TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE[objective][0]]}
          </span>
        </button>
      ))}
    </div>
  );
}
