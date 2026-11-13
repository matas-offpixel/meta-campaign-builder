/**
 * R2, R3 and R5: one proposal per campaign from the facts the loader
 * gathered. Pure — no database, no Meta, no Drive. Every number a line
 * states is in its evidence snapshot, so P5 can score it later (R6).
 *
 * Line order is expected effect: adds and the claim (supply, always
 * allowed), then pauses by spend, bring-backs by how far under the
 * campaign's cost they ran, the missing standing default, drops by how far
 * over, then the move. A rule's track record (R6) is not sorted on yet.
 */

import { RESULT_LABEL, type PhaseConfig, type ResultEvent } from "./phase-config.ts";
import { purchaseWhy, unreadPurchases, type PurchaseRead } from "./purchases.ts";
import { dayMonth, shortDay, type RunPlan } from "./schedule.ts";

export type AdInput = {
  adId: string;
  adsetId: string;
  /** Meta ad name; creative_scores keys on it. */
  name: string;
  firstDay: string;
  lastDay: string;
  weekSpend: number;
  weekResults: number;
  totalSpend: number;
  totalResults: number;
  /** creative_scores convert axis, latest run. */
  convertScore: number | null;
  significant: boolean;
};

export type AdSetInput = {
  /** The Meta id the write targets: the newest id with spend under this name. */
  adsetId: string;
  /** Every Meta id behind the name (F4: a rebuilt campaign's copy is the same ad set). */
  adsetIds: string[];
  name: string;
  firstDay: string;
  lastDay: string;
  weekSpend: number;
  weekResults: number;
  totalSpend: number;
  totalResults: number;
  /** Spent on the window's last two days. */
  delivering: boolean;
  /** P3: its spend over its last 7 days of delivery, per day — what a bring-back would spend each day (R5's plan guard). */
  recentDailySpend?: number;
};

export type ClusterInput = {
  id: string;
  name: string;
  /** The event's client, when the cluster ran for it (live_evidence.perClient); null = no own results. */
  client: string | null;
  /** The client's own cprIndex from live_evidence.perClient (cost-based: lower is better); never the pooled index. */
  index: number | null;
  /** 0 thin · 0.5 ok · 1 strong (lib/learning/shrink.ts CONFIDENCE_SCORE), the client's own. */
  confidence: number;
  confidenceWord: "thin" | "ok" | "strong";
  usedOnEvent: boolean;
};

export type SupplyMix = "ugc" | "cta" | "no_cta" | "unknown";

export type SupplyFile = {
  fileId: string;
  name: string;
  owner: string;
  kind: "video" | "static";
  mix: SupplyMix;
  /** The Drive path under the cycle folder, for the line. */
  path: string;
  alreadyInCampaign: boolean;
  /**
   * How "already in the campaign" was decided: a Lab launch of a render
   * with this Drive id, or (P2) an applied refresh add line with it. Hand
   * uploads are not matched.
   */
  matchedBy: "lab_launch" | "refresh_apply";
};

/** The copy a new ad goes in with: the campaign draft's own (P2). Shown on the line before Accept. */
export type AddCopy = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  destinationUrl: string;
  pageId: string;
  instagramActorId: string | null;
  /** The draft creative it was read from. */
  fromCreative: string | null;
};

/** R5 "where to write": the event's draft for this campaign on this account. */
export type CampaignDraftRef = { draftId: string; adAccountId: string; copy: AddCopy | null };

export type ClaimInput = {
  id: string;
  claim: string;
  approvedAt: string | null;
  runsFrom: string | null;
  runsTo: string | null;
  renderId: string | null;
};

export type CampaignInput = {
  eventId: string;
  eventCode: string | null;
  eventName: string;
  /** The campaign name; a rebuilt campaign under the same name is the same campaign. */
  campaignKey: string;
  campaignIds: string[];
  /** P2: the account the campaign runs on (act_…), from its ad-days. */
  adAccountId?: string | null;
  /** P2: this event's draft for the campaign on that account; null = nothing can be applied to it. */
  draft?: CampaignDraftRef | null;
  onSaleDay: string | null;
  plan: RunPlan;
  resultEvent: ResultEvent;
  /** Window totals, in the result the campaign optimises for. */
  weekSpend: number;
  weekResults: number;
  /** Since on sale, to the window's end. */
  totalSpend: number;
  totalResults: number;
  totalFirstDay: string | null;
  ads: AdInput[];
  adSets: AdSetInput[];
  clusters: ClusterInput[];
  supply: SupplyFile[];
  claims: ClaimInput[];
  budgetGbp: number | null;
  /** Every campaign of the event, to the window's end. */
  spendToDateGbp: number;
  ticketingLinked: boolean;
  ticketingProvider: string | null;
  /** The event's campaigns, last 14 days to the window's end. */
  last14: { ic: number; purchases: number; lpv: number };
  /** The event's campaigns since on sale. */
  sinceOnSale: { ic: number; purchases: number; fromDay: string | null };
  /** The show's own purchases (per-event purchases record, E1–E4), read once per event. Absent = not read. */
  purchases?: PurchaseRead;
};

export type LineKind =
  | "add_creative"
  | "claim_ready"
  | "pause_creative"
  | "bring_back_audience"
  | "missing_default"
  | "drop_audience"
  | "move_budget";

export type ProposalLine = {
  kind: LineKind;
  ruleId: string;
  /** The panel's first line: the kind's label is drawn by the panel. */
  title: string;
  /** The evidence sentence(s). */
  detail: string;
  /** What Apply would write (P2+). */
  writeText: string;
  /** F2's wording at 393: a shorter detail and, when the write line is dropped there, null. */
  narrow: { detail: string; writeText: string | null };
  target: Record<string, unknown>;
  evidence: Record<string, unknown>;
  write: Record<string, unknown> | null;
  addsSpend: boolean;
  /** R5: set when the line cannot be accepted yet. */
  blockedReason: string | null;
  /** A supply line points to the Lab, not Meta. */
  supply: boolean;
};

export type WatchItem = { title: string; detail: string; narrow: string; evidence: Record<string, unknown> };

export type Proposal = {
  objective: ResultEvent;
  /**
   * The Objective block. `pixel` is E4's setup lines; `attributed` is C2's
   * any-show figure under the purchase line. Proposals stored before the
   * per-event purchases record carry neither (their purchase line says
   * the attributed figure itself).
   */
  why: {
    objective: string;
    purchase: string;
    purchaseNarrow: string;
    moves: string;
    ticketing: string | null;
    pixel?: string[];
    pixelNarrow?: string[];
    /** Null on the platform path, where the attributed figure is the count (T4 of the ticket-platform record). */
    attributed?: string | null;
    attributedNarrow?: string | null;
    /** T4: the platform's share of the pixel's purchases, under the platform states. */
    context?: string | null;
    contextNarrow?: string | null;
  };
  /** R5: only the budget blocks a line. Ticketing is a stated input, said under Objective (F9). */
  blockers: { kind: "budget"; text: string; action: string }[];
  enoughData: boolean;
  /** The sentence shown when the week is under the floor. */
  notEnoughData: string | null;
  lines: ProposalLine[];
  watch: { creatives: WatchItem[]; audiences: WatchItem[] };
  /** Sentences the panel shows when a section has no line, and the adds' matching caveat (F7). */
  notes: { pauses: string; drops: string; adds: string };
  campaignSummary: string;
};

const gbp = (value: number) => `£${value.toFixed(2)}`;
const ratioText = (value: number) => `${(Math.round(value * 100) / 100).toString()}×`;

function cpr(spend: number, results: number): number | null {
  return results > 0 && spend > 0 ? spend / results : null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export const RETARGETING = /retarget/i;
const REG_LOOKALIKE = /lookalike|\bLL\b|\bLAL\b/i;

/** R3: IC when the event logged enough in 14 days; the pixel's own count is P4; else LPV. */
export function chooseObjective(input: Pick<CampaignInput, "last14">, config: PhaseConfig, pixelIc7d: number | null = null): ResultEvent {
  if (input.last14.ic >= config.icMinIn14Days) return config.resultEvent;
  if (pixelIc7d != null && pixelIc7d >= config.icPixelMinIn7Days) return config.resultEvent;
  return config.fallbackResultEvent;
}

export function whyLines(input: CampaignInput, objective: ResultEvent, config: PhaseConfig): Proposal["why"] {
  const since = input.sinceOnSale.fromDay ? ` since ${dayMonth(input.sinceOnSale.fromDay)}` : "";
  const objectiveLine =
    objective === "initiate_checkout"
      ? `Initiate Checkout — ${input.sinceOnSale.ic} reached the pixel${since}. Last 14 days: ${input.last14.ic} IC.`
      : `Landing Page View — the pixel logged ${input.last14.ic} Initiate Checkout in 14 days, under ${config.icMinIn14Days}. Last 14 days: ${input.last14.lpv} LPV.`;
  // E1–E4: the purchase line is the show's own-domain count on the pixel its ad sets carry. The ads' attributed
  // purchases are any show's (C2) and sit under it, labelled; they decide nothing.
  const read = input.purchases ?? unreadPurchases(input.last14.purchases, config);
  const lines = purchaseWhy({ ...read, attributedPurchases: { count: input.last14.purchases, scope: "any_show_on_pixel" } }, input.ticketingLinked, config);
  return { objective: objectiveLine, ...lines };
}

export function blockersFor(input: CampaignInput): Proposal["blockers"] {
  const out: Proposal["blockers"] = [];
  if (input.budgetGbp == null) out.push({ kind: "budget", text: "This event has no marketing budget, so nothing that adds spend can be accepted.", action: "Set budget" });
  return out;
}

export function remainingBudget(input: Pick<CampaignInput, "budgetGbp" | "spendToDateGbp">): number | null {
  if (input.budgetGbp == null) return null;
  return Math.max(0, input.budgetGbp - input.spendToDateGbp);
}

type Creative = { name: string; ads: AdInput[]; weekSpend: number; weekResults: number; totalSpend: number; totalResults: number; firstDay: string; convertScore: number | null; significant: boolean };

function creativesOf(ads: readonly AdInput[]): Creative[] {
  const byName = new Map<string, Creative>();
  for (const ad of ads) {
    const have = byName.get(ad.name) ?? { name: ad.name, ads: [], weekSpend: 0, weekResults: 0, totalSpend: 0, totalResults: 0, firstDay: ad.firstDay, convertScore: ad.convertScore, significant: ad.significant };
    have.ads.push(ad);
    have.weekSpend += ad.weekSpend;
    have.weekResults += ad.weekResults;
    have.totalSpend += ad.totalSpend;
    have.totalResults += ad.totalResults;
    if (ad.firstDay < have.firstDay) have.firstDay = ad.firstDay;
    have.convertScore = ad.convertScore ?? have.convertScore;
    have.significant = have.significant || ad.significant;
    byName.set(ad.name, have);
  }
  return [...byName.values()];
}

/** Ads of this creative that are the last delivering ad in their ad set. */
function lastDeliveringAds(creative: Creative, ads: readonly AdInput[], adSets: readonly AdSetInput[]): AdInput[] {
  const delivering = new Set(adSets.filter((set) => set.delivering).map((set) => set.adsetId));
  return creative.ads.filter((ad) => {
    if (!delivering.has(ad.adsetId)) return false;
    const others = ads.filter((other) => other.adsetId === ad.adsetId && other.adId !== ad.adId && other.weekSpend > 0);
    return others.length === 0;
  });
}

/**
 * R2 pause creative. Watch (F5) holds only creatives past the cost bar
 * that are not yet significant, significant and bottom third but live
 * under 7 days, or kept because they are the last delivering ad in their
 * ad set. A significant creative outside the bottom third is not shown.
 * The mid-cycle check proposes no pauses (F6); Watch still shows.
 */
export function pauseLines(input: CampaignInput, config: PhaseConfig): { lines: ProposalLine[]; watch: WatchItem[]; note: string } {
  const label = RESULT_LABEL[input.resultEvent].short;
  const campaignCpr = cpr(input.weekSpend, input.weekResults);
  const creatives = creativesOf(input.ads).filter((creative) => creative.weekSpend > 0);
  const watch: WatchItem[] = [];
  const lines: ProposalLine[] = [];
  if (campaignCpr == null) return { lines, watch, note: `No pauses: the campaign has no ${label} cost this week.` };
  const midCycle = input.plan.runKind === "mid_cycle";
  const scored = creatives.filter((creative) => creative.convertScore != null).sort((a, b) => a.convertScore! - b.convertScore!);
  const bottomThird = new Set(scored.slice(0, Math.floor(scored.length / 3)).map((creative) => creative.name));
  const candidates = creatives
    .filter((creative) => creative.totalSpend >= config.pauseSpendMultiple * campaignCpr)
    .sort((a, b) => b.totalSpend - a.totalSpend);
  for (const creative of candidates) {
    const creativeCpr = cpr(creative.totalSpend, creative.totalResults);
    const daysLive = daysBetween(creative.firstDay, input.plan.window.end) + 1;
    const evidence = {
      creative: creative.name,
      ads: creative.ads.length,
      spend: round2(creative.totalSpend),
      results: creative.totalResults,
      cpr: creativeCpr == null ? null : round2(creativeCpr),
      campaignCpr: round2(campaignCpr),
      cprRatio: creativeCpr == null ? null : round2(creativeCpr / campaignCpr),
      convertScore: creative.convertScore,
      significant: creative.significant,
      daysLive,
      window: input.plan.window,
    };
    const costText = `${creative.ads.length} ads · ${gbp(creative.totalSpend)} · ${creative.totalResults} ${label}${creativeCpr == null ? "" : ` · ${gbp(creativeCpr)} each, ${ratioText(creativeCpr / campaignCpr)} the campaign`}`;
    const narrow = `${creative.name} · ${gbp(creative.totalSpend)} · ${creative.totalResults} ${label}`;
    const inBottomThird = bottomThird.has(creative.name);
    if (!creative.significant) {
      watch.push({ title: creative.name, detail: `${costText} · convert ${creative.convertScore ?? "—"}, not yet significant`, narrow, evidence });
      continue;
    }
    if (!inBottomThird) continue;
    if (daysLive < config.minDays) {
      watch.push({ title: creative.name, detail: `${costText} · convert ${creative.convertScore}, significant · bottom third · live ${daysLive} day${daysLive === 1 ? "" : "s"}`, narrow, evidence });
      continue;
    }
    const lastInSet = lastDeliveringAds(creative, input.ads, input.adSets);
    const adIds = creative.ads.filter((ad) => !lastInSet.some((last) => last.adId === ad.adId)).map((ad) => ad.adId);
    if (!adIds.length) {
      watch.push({ title: creative.name, detail: `${costText} · the last delivering ad in its ad set, so it stays`, narrow, evidence });
      continue;
    }
    if (midCycle || lines.length >= config.maxPauses) continue;
    lines.push({
      kind: "pause_creative",
      ruleId: "pause.significant_bottom_third",
      title: creative.name,
      detail: `${costText} · convert ${creative.convertScore}, significant · bottom third`,
      writeText: `Pause ${adIds.length} ad${adIds.length === 1 ? "" : "s"} · ad status write`,
      narrow: { detail: `${gbp(creative.totalSpend)} · ${creative.totalResults} ${label}${creativeCpr == null ? "" : ` · ${gbp(creativeCpr)} each, ${ratioText(creativeCpr / campaignCpr)}`}`, writeText: null },
      target: { creative: creative.name, adIds, ads: creative.ads.filter((ad) => adIds.includes(ad.adId)).map((ad) => ({ adId: ad.adId, adsetId: ad.adsetId })) },
      evidence,
      write: { kind: "ad_status", adIds, status: "PAUSED", campaignIds: input.campaignIds, adAccountId: input.adAccountId ?? null, draftId: input.draft?.draftId ?? null },
      addsSpend: false,
      blockedReason: notOurs(input),
      supply: false,
    });
  }
  const note = lines.length ? "" : midCycle ? "No pauses on a mid-cycle check." : "No pauses: no creative has enough evidence.";
  return { lines, watch, note };
}

const MIX_LABEL: Record<SupplyMix, string> = { ugc: "UGC", cta: "CTA", no_cta: "No CTA", unknown: "" };

/** R2 add creative: the cycle's approved finals not yet in the campaign, 2 in 3 from the cycle's lead folders, at most maxAdds. Cycle refresh only. */
export function addLines(input: CampaignInput, config: PhaseConfig): ProposalLine[] {
  if (input.plan.runKind === "mid_cycle") return [];
  const fresh = input.supply.filter((file) => !file.alreadyInCampaign);
  const lead = (file: SupplyFile) => (input.plan.cycleKind === "payday" ? file.mix === "cta" : file.mix === "ugc" || file.mix === "no_cta");
  const leads = fresh.filter(lead);
  const others = fresh.filter((file) => !lead(file));
  const picked: SupplyFile[] = [];
  const leadQuota = Math.ceil(config.maxAdds * config.addMixShare);
  while (picked.length < config.maxAdds && (leads.length || others.length)) {
    const leadCount = picked.filter(lead).length;
    const next = leads.length && (leadCount < leadQuota || !others.length) ? leads.shift()! : others.shift()!;
    picked.push(next);
  }
  const delivering = input.adSets.filter((set) => set.delivering).map((set) => set.adsetId);
  const cycleWord = input.plan.cycleKind === "payday" ? "payday cycle" : "content cycle";
  const copy = input.draft?.copy ?? null;
  const blocked = notOurs(input) ?? (copy ? null : NO_COPY);
  return picked.map((file) => ({
    kind: "add_creative" as const,
    ruleId: "add.cycle_folder",
    title: file.name,
    detail: `${file.path} · approved final · ${cycleWord}`,
    writeText: `New ad in each delivering ad set (${delivering.length}) · launch path · goes in live`,
    narrow: { detail: `${file.path} · ${cycleWord}`, writeText: "New ad in each delivering ad set · live" },
    target: { driveFileId: file.fileId, name: file.name, owner: file.owner, kind: file.kind, mix: MIX_LABEL[file.mix] || null, copy },
    evidence: { path: file.path, cycleMonday: input.plan.cycleMonday, cycleKind: input.plan.cycleKind, deliveringAdSets: delivering.length, matchedBy: file.matchedBy },
    write: { kind: "add_ads", driveFileId: file.fileId, adsetIds: delivering, status: "ACTIVE", campaignIds: input.campaignIds, adAccountId: input.adAccountId ?? null, draftId: input.draft?.draftId ?? null },
    addsSpend: false,
    blockedReason: blocked,
    supply: false,
  }));
}

/** R5: only campaigns of this event's drafts on this account are written to. */
export const NOT_OURS = "Not one of this event's drafts on this account, so nothing is written to this campaign.";
/** An add needs the draft's page and link; without them there is no copy to show or send. */
export const NO_COPY = "The campaign's draft has no page or link to copy, so this can't go in until the draft has them.";

function notOurs(input: Pick<CampaignInput, "draft">): string | null {
  return input.draft ? null : NOT_OURS;
}

/** What every write re-checks at apply time: the campaign, its account and this event's draft for it. */
function whereTo(input: Pick<CampaignInput, "campaignIds" | "adAccountId" | "draft">): { campaignIds: string[]; adAccountId: string | null; draftId: string | null } {
  return { campaignIds: input.campaignIds, adAccountId: input.adAccountId ?? null, draftId: input.draft?.draftId ?? null };
}

/** R2 claim ready: an approved ticket-warning claim in its window with no render. A supply line, not a Meta write. */
export function claimLines(input: CampaignInput): ProposalLine[] {
  if (input.plan.runKind === "mid_cycle") return [];
  const end = `${input.plan.window.end}T23:59:59Z`;
  return input.claims
    .filter((claim) => claim.approvedAt && !claim.renderId && (!claim.runsFrom || claim.runsFrom <= end) && (!claim.runsTo || claim.runsTo >= `${input.plan.day}T00:00:00Z`))
    .map((claim) => ({
      kind: "claim_ready" as const,
      ruleId: "claim.approved_no_render",
      title: `“${claim.claim.replace(/\s*\n\s*/g, " / ")}”`,
      detail: `Approved · live since ${claim.runsFrom ? dayMonth(claim.runsFrom.slice(0, 10)) : dayMonth(claim.approvedAt!.slice(0, 10))} · no render yet`,
      writeText: input.plan.nextCycle ? `Make it in the Lab: it joins the ${dayMonth(input.plan.nextCycle)} ${input.plan.nextCycleKind ?? ""} cycle's adds`.replace("  ", " ") : "Make it in the Lab",
      narrow: { detail: `Approved · live since ${claim.runsFrom ? dayMonth(claim.runsFrom.slice(0, 10)) : dayMonth(claim.approvedAt!.slice(0, 10))} · no render yet`, writeText: input.plan.nextCycle ? `Make it in the Lab: it joins the ${dayMonth(input.plan.nextCycle)} ${input.plan.nextCycleKind ?? ""} cycle's adds`.replace("  ", " ") : "Make it in the Lab" },
      target: { ticketWarningId: claim.id },
      evidence: { claim: claim.claim, approvedAt: claim.approvedAt, runsFrom: claim.runsFrom, runsTo: claim.runsTo },
      write: null,
      addsSpend: false,
      blockedReason: null,
      supply: true,
    }));
}

export function audienceLines(input: CampaignInput, config: PhaseConfig): { lines: ProposalLine[]; watch: WatchItem[]; note: string } {
  const label = RESULT_LABEL[input.resultEvent].short;
  const lines: ProposalLine[] = [];
  const watch: WatchItem[] = [];
  const campaignCpr = cpr(input.weekSpend, input.weekResults);
  const totalCpr = cpr(input.totalSpend, input.totalResults);
  const remaining = remainingBudget(input);
  const spendBlock = input.budgetGbp == null ? "Adds spend: set this event's budget to accept this." : null;

  // Bring back a stopped ad set.
  for (const set of input.adSets.filter((set) => !set.delivering)) {
    const setCpr = cpr(set.totalSpend, set.totalResults);
    if (totalCpr == null || setCpr == null) continue;
    if (set.totalResults < config.bringBackMinResults || setCpr > config.bringBackMaxCprRatio * totalCpr) continue;
    lines.push({
      kind: "bring_back_audience",
      ruleId: "bring_back.stopped_ad_set",
      title: set.name,
      detail: `Stopped ${dayMonth(set.lastDay)} · ${gbp(set.totalSpend)} · ${set.totalResults} ${label} · ${gbp(setCpr)} each, ${ratioText(setCpr / totalCpr)} the campaign`,
      writeText: "Ad set status → on · its own budget",
      narrow: { detail: `${gbp(set.totalSpend)} · ${set.totalResults} ${label} · ${gbp(setCpr)} each, ${ratioText(setCpr / totalCpr)}`, writeText: null },
      target: { adsetId: set.adsetId, adsetIds: set.adsetIds, name: set.name },
      evidence: { spend: round2(set.totalSpend), results: set.totalResults, cpr: round2(setCpr), campaignCpr: round2(totalCpr), cprRatio: round2(setCpr / totalCpr), stoppedOn: set.lastDay, dailySpend: set.recentDailySpend == null ? null : round2(set.recentDailySpend) },
      write: { kind: "adset_status", adsetId: set.adsetId, status: "ACTIVE", ...whereTo(input) },
      addsSpend: true,
      blockedReason: notOurs(input) ?? spendBlock,
      supply: false,
    });
  }
  // G1: bring back a cluster that ran for this client (its own perClient figures, registration stage) and is not used on this event.
  for (const cluster of input.clusters) {
    if (cluster.usedOnEvent || cluster.index == null || !cluster.client) continue;
    if (cluster.index > config.bringBackClusterCprIndexAtMost || cluster.confidence < config.bringBackClusterConfidenceAtLeast) continue;
    lines.push({
      kind: "bring_back_audience",
      ruleId: "bring_back.client_cluster",
      title: cluster.name,
      detail: `Ran for ${cluster.client} at ${cluster.index}× its cost per registration · confidence ${cluster.confidenceWord} · not used on this event`,
      writeText: "New ad set through the launch path · its own budget",
      narrow: { detail: `${cluster.index}× ${cluster.client}'s cost per registration · confidence ${cluster.confidenceWord}`, writeText: null },
      target: { clusterId: cluster.id, name: cluster.name },
      evidence: { client: cluster.client, stage: "registration", cprIndex: cluster.index, confidence: cluster.confidenceWord, atMost: config.bringBackClusterCprIndexAtMost },
      write: { kind: "new_adset", clusterId: cluster.id },
      addsSpend: true,
      blockedReason: spendBlock,
      supply: false,
    });
  }
  lines.sort((a, b) => Number(a.evidence.cprRatio ?? 9) - Number(b.evidence.cprRatio ?? 9));

  // Missing standing default.
  const delivering = input.adSets.filter((set) => set.delivering);
  if (delivering.length && !delivering.some((set) => RETARGETING.test(set.name))) {
    lines.push(missingDefault("retargeting", "A retargeting ad set", spendBlock));
  }
  if (delivering.length && !delivering.some((set) => REG_LOOKALIKE.test(set.name))) {
    lines.push(missingDefault("registrations_lookalike", "The registrations lookalike in its own ad set", spendBlock));
  }

  // Drop a delivering ad set.
  let note = "";
  if (campaignCpr != null) {
    const dropCandidates = delivering
      .map((set) => ({ set, setCpr: cpr(set.weekSpend, set.weekResults) }))
      .filter(({ set, setCpr }) => (setCpr ?? Number.POSITIVE_INFINITY) >= config.watchCprRatio * campaignCpr || (set.weekResults === 0 && set.weekSpend >= config.dropSpendMultiple * campaignCpr));
    for (const { set, setCpr } of dropCandidates) {
      const daysLive = daysBetween(set.firstDay, input.plan.window.end) + 1;
      const ratio = setCpr == null ? null : setCpr / campaignCpr;
      const evidence = { adset: set.name, spend: round2(set.weekSpend), results: set.weekResults, cpr: setCpr == null ? null : round2(setCpr), campaignCpr: round2(campaignCpr), cprRatio: ratio == null ? null : round2(ratio), daysLive, window: input.plan.window };
      const costText = `${gbp(set.weekSpend)} · ${set.weekResults} ${label}${setCpr == null ? "" : ` · ${gbp(setCpr)} each, ${ratioText(setCpr / campaignCpr)} the campaign`}`;
      const qualifies = daysLive >= config.minDays && set.weekSpend >= config.dropSpendMultiple * campaignCpr && (setCpr == null || setCpr >= config.dropCprRatio * campaignCpr) && !RETARGETING.test(set.name) && delivering.length > 1;
      if (!qualifies) {
        watch.push({ title: set.name, detail: `${costText} (drops at ${config.dropCprRatio}×)${daysLive < config.minDays ? ` · live ${daysLive} day${daysLive === 1 ? "" : "s"}` : ""}`, narrow: `${set.name} · ${gbp(set.weekSpend)} · ${set.weekResults} ${label}`, evidence });
        continue;
      }
      lines.push({
        kind: "drop_audience",
        ruleId: "drop.over_cost",
        title: set.name,
        detail: `${costText} · live ${daysLive} days`,
        writeText: "Ad set status → off",
        narrow: { detail: `${gbp(set.weekSpend)} · ${set.weekResults} ${label}${setCpr == null ? "" : ` · ${gbp(setCpr)} each, ${ratioText(setCpr / campaignCpr)}`}`, writeText: null },
        target: { adsetId: set.adsetId, adsetIds: set.adsetIds, name: set.name },
        evidence: { ...evidence, deliveringAdSets: delivering.length },
        write: { kind: "adset_status", adsetId: set.adsetId, status: "PAUSED", ...whereTo(input) },
        addsSpend: false,
        blockedReason: notOurs(input),
        supply: false,
      });
    }
    if (!lines.some((line) => line.kind === "drop_audience")) note = "No drops: none qualifies.";
  } else {
    note = `No drops: the campaign has no ${label} cost this week.`;
  }

  // Move budget within the campaign (R3 without a purchase signal; R5 cap).
  if (campaignCpr != null && delivering.length > 1) {
    const ranked = delivering
      .map((set) => ({ set, setCpr: cpr(set.weekSpend, set.weekResults) }))
      .filter((row) => row.setCpr != null)
      .sort((a, b) => a.setCpr! - b.setCpr!);
    const best = ranked.find((row) => row.set.weekResults >= config.moveToMinResults);
    const worst = ranked.at(-1);
    if (best && worst && best.set.adsetId !== worst.set.adsetId && best.setCpr! <= config.moveToCprRatio * campaignCpr && worst.setCpr! >= config.moveFromCprRatio * campaignCpr) {
      const cap = remaining == null ? null : round2(remaining * config.moveCapShare);
      const wanted = round2(worst.set.weekSpend / 2);
      const amount = cap == null ? wanted : Math.min(cap, wanted);
      lines.push({
        kind: "move_budget",
        ruleId: "move.within_campaign",
        title: `${worst.set.name} → ${best.set.name}`,
        detail: `${gbp(worst.setCpr!)} per ${label} (${ratioText(worst.setCpr! / campaignCpr)}) to ${gbp(best.setCpr!)} per ${label} (${ratioText(best.setCpr! / campaignCpr)}) · ${gbp(amount)} a week${cap != null ? ` · cap ${gbp(cap)} (20 % of ${gbp(remaining!)} remaining)` : ""}`,
        writeText: "Ad-set budget write, both sides",
        narrow: { detail: `${gbp(amount)} a week${cap != null ? ` · cap ${gbp(cap)}` : ""}`, writeText: null },
        target: { fromAdsetId: worst.set.adsetId, toAdsetId: best.set.adsetId },
        evidence: { fromCpr: round2(worst.setCpr!), toCpr: round2(best.setCpr!), campaignCpr: round2(campaignCpr), amountGbp: amount, capGbp: cap, remainingBudgetGbp: remaining },
        write: { kind: "adset_budget_move", fromAdsetId: worst.set.adsetId, toAdsetId: best.set.adsetId, amountGbp: amount, ...whereTo(input) },
        addsSpend: false,
        blockedReason: notOurs(input) ?? (remaining == null ? "Moves need the event's budget to size the cap: set this event's budget to accept this." : null),
        supply: false,
      });
    }
  }
  return { lines, watch, note };
}

function missingDefault(which: string, title: string, spendBlock: string | null): ProposalLine {
  return {
    kind: "missing_default",
    ruleId: `missing_default.${which}`,
    title,
    detail: "Standing default · not in the campaign",
    writeText: "New ad set through the launch path · its own budget",
    narrow: { detail: "Standing default · not in the campaign", writeText: null },
    target: { default: which },
    evidence: {},
    write: { kind: "new_adset", default: which },
    addsSpend: true,
    blockedReason: spendBlock,
    supply: false,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function campaignSummary(input: CampaignInput): string {
  const label = RESULT_LABEL[input.resultEvent].short;
  const from = input.totalFirstDay ? dayMonth(input.totalFirstDay) : null;
  const totalCpr = cpr(input.totalSpend, input.totalResults);
  return `${from ? `${from} – ` : ""}${dayMonth(input.plan.window.end)} · ${gbp(input.totalSpend)} · ${input.totalResults} ${label}${totalCpr == null ? "" : ` · ${gbp(totalCpr)} each`}`;
}

export function buildProposal(input: CampaignInput, config: PhaseConfig): Proposal {
  const objective = input.resultEvent;
  const why = whyLines(input, objective, config);
  const blockers = blockersFor(input);
  const enoughData = input.weekResults >= config.minResultsPerWeek;
  const notEnoughData = enoughData
    ? null
    : `Not enough data this week (${input.weekResults} ${RESULT_LABEL[input.resultEvent].short}, under ${config.minResultsPerWeek})${input.plan.nextCheck ? ` — next check ${shortDay(input.plan.nextCheck)}` : ""}.`;
  const adds = addLines(input, config);
  const claims = claimLines(input);
  const pauses = enoughData ? pauseLines(input, config) : { lines: [], watch: [], note: "No pauses: not enough data this week." };
  const audiences = enoughData ? audienceLines(input, config) : { lines: [], watch: [], note: "No drops or moves: not enough data this week." };
  // C2 / P2: every line's evidence snapshot keeps the pixel-wide figure, labelled as any show's — never this show's purchases.
  const attributedPurchases = { count: input.last14.purchases, scope: "any_show_on_pixel" as const };
  const lines = [...adds, ...claims, ...pauses.lines, ...audiences.lines].map((line) => ({ ...line, evidence: { ...line.evidence, attributedPurchases } }));
  return {
    objective,
    why,
    blockers,
    enoughData,
    notEnoughData,
    lines,
    watch: { creatives: pauses.watch, audiences: audiences.watch },
    notes: { pauses: pauses.note, drops: audiences.note, adds: "Files uploaded by hand in Ads Manager aren't matched." },
    campaignSummary: campaignSummary(input),
  };
}
