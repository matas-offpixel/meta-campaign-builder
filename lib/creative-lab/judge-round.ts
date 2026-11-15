/**
 * Run the M1 judge for one Lab round. Dry-run returns the table.
 * apply writes verdict columns. It does not pause or launch anything.
 */

import { judgeRound, type JudgeRoundAd } from "./judge.ts";
import {
  loadAdSetLedger,
  loadAdSetRows,
  loadClientBaselines,
  loadCurrency,
  loadDataThrough,
  loadStageEvents,
  type ServiceRoleDb,
} from "./load.ts";
import { londonDay } from "./upcoming.ts";

type Row = Record<string, unknown>;

function text(row: Row | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

export async function judgeLabRound(
  db: ServiceRoleDb,
  args: { userId: string; roundId: string; apply: boolean; now?: Date },
) {
  const roundRes = await db.from("creative_lab_rounds").select("*").eq("id", args.roundId).eq("user_id", args.userId).maybeSingle();
  if (roundRes.error) throw new Error(roundRes.error.message);
  const round = roundRes.data as Row | null;
  if (!round) throw new Error("No round with that id.");

  const [adRes, launchRes] = await Promise.all([
    db.from("creative_lab_round_ads").select("*").eq("round_id", args.roundId),
    db.from("creative_lab_round_ad_launches").select("*").eq("user_id", args.userId),
  ]);
  if (adRes.error) throw new Error(adRes.error.message);
  if (launchRes.error) throw new Error(launchRes.error.message);
  const ads = (adRes.data ?? []) as Row[];
  const launches = ((launchRes.data ?? []) as Row[]).filter((row) => ads.some((ad) => text(ad, "id") === text(row, "round_ad_id")));
  const roundAds: JudgeRoundAd[] = ads.map((ad) => ({
    key: text(ad, "id"),
    label: text(ad, "ad_name"),
    launches: launches
      .filter((row) => text(row, "round_ad_id") === text(ad, "id"))
      .map((row) => ({ metaAdId: text(row, "meta_ad_id"), adSetId: text(row, "meta_adset_id") })),
    liveFrom: null,
    clipId: text(ad, "clip_id") || null,
    captionId: text(ad, "caption_id") || null,
  }));
  const adSetIds = [...new Set(roundAds.flatMap((ad) => ad.launches.map((launch) => launch.adSetId)).filter(Boolean))];
  const today = londonDay(args.now ?? new Date());
  const through = (await loadDataThrough(db, [])) ?? today;
  const [rows, ledger, currency] = await Promise.all([
    loadAdSetRows(db, adSetIds, through),
    loadAdSetLedger(db, adSetIds),
    loadCurrency(db),
  ]);
  const eventIds = [...new Set([...ledger.values()].map((row) => row.eventId).filter((id): id is string => Boolean(id)))];
  const clientIds = [...new Set([...ledger.values()].map((row) => row.clientId).filter((id): id is string => Boolean(id)))];
  const [events, baselines] = await Promise.all([loadStageEvents(db, eventIds), loadClientBaselines(db, clientIds)]);
  const adSets = new Map(
    [...ledger.entries()].map(([id, row]) => [id, { phaseAtLaunch: row.phaseAtLaunch, event: row.eventId ? events.get(row.eventId) ?? null : null, clientId: row.clientId }]),
  );
  const result = judgeRound({ judgedOn: today, rows, roundAds, adSets, baselines, currency, dataThrough: through });
  if (args.apply) {
    for (const verdict of result.verdicts) {
      const updated = await db
        .from("creative_lab_round_ads")
        .update({
          verdict: verdict.verdict,
          verdict_reason: verdict.reason,
          verdict_results: verdict.results,
          verdict_cost_per_result: verdict.costPerResult,
          verdict_fair_share: verdict.fairShare,
          verdict_spend_share: verdict.spendShare,
          result_metric: verdict.resultMetric,
          window_start: result.windowStart,
          window_end: result.windowEnd,
        })
        .eq("id", verdict.key)
        .eq("user_id", args.userId);
      if (updated.error) throw new Error(updated.error.message);
    }
    if (text(round, "status") === "launched") {
      const judged = await db
        .from("creative_lab_rounds")
        .update({ status: "judged", judged_at: (args.now ?? new Date()).toISOString() })
        .eq("id", args.roundId)
        .eq("user_id", args.userId);
      if (judged.error) throw new Error(judged.error.message);
    }
  }
  return {
    applied: args.apply,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    verdicts: result.verdicts.map((verdict) => ({
      ad: verdict.label,
      verdict: verdict.verdict,
      reason: verdict.reason,
      results: verdict.results,
      spendGbp: verdict.spendGbp,
    })),
  };
}
