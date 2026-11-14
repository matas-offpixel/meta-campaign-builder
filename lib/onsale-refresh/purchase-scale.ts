/**
 * P4 PR C — scaling the Purchase campaign, depending on results, and copying
 * a winning audience into it (docs/design-record/2026-11-14-purchase-campaigns.html,
 * PC4, PC5's Scale and Copy audience words, HP4). Pure: the run's ad-days and
 * budgets in, a line or a hold note out. Nothing here writes.
 *
 * Scale Purchase, checked at every refresh once the Purchase campaign has
 * run 7 full days since it started or since its last step, while the
 * purchase signal still holds:
 *   - up, doubling the daily rate, when it ran at or below the main
 *     campaign's cost per purchase, with 3 or more purchases;
 *   - hold (a note, not a line) within 1.5×, or under 3 purchases;
 *   - down, halving it (never below £5), above 1.5×, with 3 or more.
 * Both sides use the same measure on the same resolved pixel (T3). A step
 * moves lifetime by the change × the days left: from plan headroom first,
 * then the main campaign's lifetime; R5's 20 % cap on the extra, and the
 * main campaign's floor; when they allow less than double, the largest
 * whole £5 that fits, and under +£5 it holds and says why. A step down gives
 * its commitment back; the Purchase lifetime never goes below its spend.
 *
 * Copy an audience into Purchase: a main-campaign ad set not already copied
 * that logged 5 or more purchases in the week at no more than 0.75× the
 * event's cost per purchase. No money moves (CBO shares the budget).
 */

import { daysInclusive, money, PC } from "./purchase-campaign.ts";
import { addDaysIso, shortDay } from "./schedule.ts";

export const SCALE = {
  /** Full days since the start or the last step before a step is checked. */
  waitDays: 7,
  /** A step needs this many purchases on the Purchase campaign. */
  minPurchases: 3,
  /** Hold above the main campaign's cost per purchase up to this ratio; halve above it. */
  holdRatio: 1.5,
  /** The rate never goes below this, £ a day. */
  floorRate: 5,
  /** Steps are whole £5s. */
  stepUnit: 5,
} as const;

export const COPY = { minPurchases: 5, maxRatio: 0.75 } as const;

/** The refresh-made Purchase campaign as the lines left it: its id, its rate, when it started and last stepped. */
export type PurchaseRunning = {
  campaignId: string;
  campaignName: string;
  mainCampaignId: string | null;
  mainCampaignKey: string;
  mainShort: string;
  /** The Apply day of the Purchase campaign line (London). */
  startedOn: string;
  /** The Apply day of the last applied Scale line, or null. */
  lastStepOn: string | null;
  /** £ a day now: the last applied Scale's, else the Purchase line's. */
  rate: number;
  /** Source ad set ids and names already in the Purchase campaign (its picks and earlier copies). */
  copied: { ids: string[]; names: string[] };
  /** The ads the Purchase campaign reuses (the Purchase line's), for a copied audience. */
  ads: { adId: string; name: string }[];
  pixelId: string;
  path: "platform" | "own_domain";
};

export type ScaleInput = {
  running: PurchaseRunning;
  runDay: string;
  windowEnd: string;
  eventDate: string;
  signalHolds: boolean;
  /** The Purchase campaign since the start or the last step, to the window's end. */
  purchase: { spend: number; purchases: number; spentToDate: number; lifetime: number | null };
  /** The main campaign over the same days. */
  main: { spend: number; purchases: number; spentToDate: number; lifetime: number | null; last7Daily: number };
  budgetGbp: number | null;
  spendToDateGbp: number;
  committedGbp: number | null;
};

export type ScaleWrite = {
  kind: "purchase_scale";
  direction: "up" | "down";
  purchaseCampaignId: string;
  mainCampaignId: string | null;
  fromRate: number;
  toRate: number;
  daysLeft: number;
  purchaseBefore: number;
  purchaseAfter: number;
  mainBefore: number | null;
  mainAfter: number | null;
  headroom: number;
  move: number;
  floor: number;
  /** The main campaign's last-7-day daily spend when proposed: Apply recomputes the floor on live spend. */
  mainDaily: number;
  since: string;
  before: { cpp: number; purchases: number; mainCpp: number; mainPurchases: number };
};

export type ScaleResult =
  | { kind: "none" }
  | { kind: "hold"; note: string }
  | { kind: "line"; title: string; detail: string; narrowDetail: string; writeText: string; narrowWrite: string; capText: string; write: ScaleWrite };

const round2 = (value: number) => Math.round(value * 100) / 100;
const each = (value: number) => `£${(Math.round(value * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const ratioText = (value: number) => `${(Math.round(value * 100) / 100).toFixed(2)}×`;

/** PC4: the step, or a hold note, or nothing (not running long enough, or the signal gone). */
export function scalePurchase(input: ScaleInput): ScaleResult {
  const { running } = input;
  const since = running.lastStepOn ?? running.startedOn;
  // 7 full days since the start or the last step: the days after it, to the window's end.
  if (daysInclusive(addDaysIso(since, 1), input.windowEnd) < SCALE.waitDays || !input.signalHolds) return { kind: "none" };
  const short = running.mainShort;
  const word = running.path === "platform" ? "per attributed purchase" : "per purchase";
  const a = running.rate;
  const p = input.purchase.purchases;
  const hold = (why: string): ScaleResult => ({ kind: "hold", note: `Purchase holds at £${a} a day: ${why}` });
  if (p < SCALE.minPurchases) return hold(`${p} purchase${p === 1 ? "" : "s"} since ${shortDay(since)}; a step needs 3.`);
  const cpp = input.purchase.spend / p;
  const mainCpp = input.main.purchases > 0 ? input.main.spend / input.main.purchases : null;
  if (mainCpp == null) return hold(`${short} has no purchases since ${shortDay(since)} to compare with.`);
  const ratio = cpp / mainCpp;
  let direction: "up" | "down";
  if (ratio <= 1 + 1e-9) direction = "up";
  else if (ratio <= SCALE.holdRatio + 1e-9) return hold(`${each(cpp)} ${word}, within 1.5× of ${short}.`);
  else direction = "down";
  const daysLeft = Math.max(0, daysInclusive(input.runDay, input.eventDate));
  if (daysLeft < 1) return { kind: "none" };
  const floor = round2(input.main.spentToDate + PC.floorDays * input.main.last7Daily);
  const purchaseBefore = input.purchase.lifetime;
  if (purchaseBefore == null) return hold(`the Purchase campaign's lifetime budget couldn't be read.`);

  let b: number;
  let headroom = 0;
  let move = 0;
  let capText = "";
  if (direction === "up") {
    // How much more it may commit: headroom first, then the main campaign's lifetime, within the 20 % cap and the main campaign's floor.
    const remainingPlan = input.budgetGbp == null ? null : Math.max(0, input.budgetGbp - input.spendToDateGbp);
    const mainLeft = input.main.lifetime == null ? null : Math.max(0, input.main.lifetime - input.main.spentToDate);
    const capBase = input.budgetGbp != null ? remainingPlan : mainLeft;
    if (capBase == null) return hold(`${short} has no lifetime budget to move from.`);
    const cap = round2(capBase * PC.capShare);
    const free = input.budgetGbp != null && input.committedGbp != null ? Math.max(0, input.budgetGbp - input.spendToDateGbp - input.committedGbp) : 0;
    const fromMain = input.main.lifetime == null ? 0 : Math.max(0, input.main.lifetime - floor);
    const allowed = Math.min(cap, free + fromMain);
    const perDay = Math.floor(allowed / daysLeft / SCALE.stepUnit) * SCALE.stepUnit;
    const extraRate = Math.min(a, perDay);
    if (extraRate < SCALE.stepUnit) {
      return hold(`20 % of ${input.budgetGbp != null ? "the plan left" : `what ${short} has left`} and ${short}'s floor leave less than £5 a day more.`);
    }
    b = a + extraRate;
    const extra = extraRate * daysLeft;
    headroom = round2(Math.min(extra, free));
    move = round2(extra - headroom);
    capText = `The extra ${money(extra)} is within 20 % of ${input.budgetGbp != null ? "the plan left" : `what ${short} has left`} (${money(cap)})${input.budgetGbp == null ? "; this event has no budget." : "."}`;
  } else {
    if (a <= SCALE.floorRate) return hold(`${each(cpp)} ${word}, over 1.5× of ${short}, and £5 a day is the floor.`);
    b = Math.max(SCALE.floorRate, Math.floor(a / 2 / SCALE.stepUnit) * SCALE.stepUnit || SCALE.floorRate);
    const giveBack = (a - b) * daysLeft;
    // The Purchase lifetime never goes below its spend to date.
    const room = Math.max(0, purchaseBefore - input.purchase.spentToDate);
    move = -round2(Math.min(giveBack, room));
  }
  const purchaseAfter = round2(purchaseBefore + (direction === "up" ? headroom + move : move));
  const mainBefore = input.main.lifetime;
  const mainAfter = mainBefore == null ? null : round2(mainBefore - move);
  const changed = Math.abs(b - a);
  const verb = direction === "up" ? "up" : "down";
  const title = `Scale Purchase ${verb}: £${a} → £${b} a day`;
  const detail = `Since ${shortDay(since)}: Purchase ${each(cpp)} ${word} (${p}), ${short} ${each(mainCpp)} (${input.main.purchases}) · ${ratioText(ratio)}`;
  const mainPart = mainBefore != null && mainAfter != null && move !== 0 ? ` · ${short} lifetime ${money(mainBefore)} → ${money(mainAfter)} (${daysLeft} days × £${changed})` : "";
  const headroomPart = headroom > 0 ? ` · ${money(headroom)} from plan headroom` : "";
  const keeps = direction === "up" && move > 0 ? ` · ${short} keeps at least ${money(floor)} (spent ${money(input.main.spentToDate)} + ${PC.floorDays} days at ${money(input.main.last7Daily)})` : "";
  const writeText = `Purchase £${a} → £${b} a day: lifetime ${money(purchaseBefore)} → ${money(purchaseAfter)}${mainPart}${headroomPart}${keeps}`;
  return {
    kind: "line",
    title,
    detail,
    narrowDetail: `Purchase ${each(cpp)} vs ${short} ${each(mainCpp)} · ${ratioText(ratio)}`,
    writeText,
    narrowWrite: `£${a} → £${b} a day · lifetime ${money(purchaseBefore)} → ${money(purchaseAfter)}`,
    capText,
    write: {
      kind: "purchase_scale",
      direction,
      purchaseCampaignId: running.campaignId,
      mainCampaignId: running.mainCampaignId,
      fromRate: a,
      toRate: b,
      daysLeft,
      purchaseBefore,
      purchaseAfter,
      mainBefore,
      mainAfter,
      headroom,
      move,
      floor,
      mainDaily: input.main.last7Daily,
      since,
      before: { cpp: round2(cpp), purchases: p, mainCpp: round2(mainCpp), mainPurchases: input.main.purchases },
    },
  };
}

export type CopyCandidate = { adsetId: string; name: string; spend: number; purchases: number };

export const NO_AUDIENCE_TO_COPY = "No audience to copy into Purchase: none had 5 purchases at 0.75× the event's cost last week.";

/** PC4's Copy an audience: main-campaign ad sets not yet copied, 5+ purchases in the week at ≤ 0.75× the event's cost per purchase, cheapest first. */
export function copyCandidates(sets: readonly CopyCandidate[], running: Pick<PurchaseRunning, "copied">, event: { spend: number; purchases: number }): { set: CopyCandidate; cpp: number; ratio: number; eventCpp: number }[] {
  if (event.purchases <= 0) return [];
  const eventCpp = event.spend / event.purchases;
  return sets
    .filter((set) => !running.copied.ids.includes(set.adsetId) && !running.copied.names.includes(set.name) && set.purchases >= COPY.minPurchases)
    .map((set) => ({ set, cpp: set.spend / set.purchases, ratio: set.spend / set.purchases / eventCpp, eventCpp }))
    .filter((row) => row.ratio <= COPY.maxRatio + 1e-9)
    .sort((x, y) => x.cpp - y.cpp || x.set.name.localeCompare(y.set.name));
}

/** The copy line's words (not drawn by the record; for design). */
export function copyLineText(row: { set: CopyCandidate; cpp: number; ratio: number; eventCpp: number }, running: Pick<PurchaseRunning, "campaignName" | "path" | "ads">): { title: string; detail: string; narrowDetail: string; writeText: string } {
  const word = running.path === "platform" ? "attributed purchases" : "purchases";
  return {
    title: row.set.name,
    detail: `${row.set.purchases} ${word} last week at ${each(row.cpp)} each, ${ratioText(row.ratio)} the event's ${each(row.eventCpp)}`,
    narrowDetail: `${row.set.purchases} at ${each(row.cpp)} · ${ratioText(row.ratio)}`,
    writeText: `Copies it into ${running.campaignName} · ${running.ads.length} ad${running.ads.length === 1 ? "" : "s"} · outside the pick test · no new money`,
  };
}

// ── PC5's words ──────────────────────────────────────────────────────────────

/** "Applied · " is the panel's. */
export function scaleAppliedText(write: Pick<ScaleWrite, "fromRate" | "toRate" | "purchaseBefore" | "purchaseAfter" | "mainBefore" | "mainAfter">, mainShort: string): string {
  const main = write.mainBefore != null && write.mainAfter != null && write.mainBefore !== write.mainAfter ? ` · ${mainShort} ${money(write.mainBefore)} → ${money(write.mainAfter)}` : "";
  return `Purchase £${write.fromRate} → £${write.toRate} a day (${money(write.purchaseBefore)} → ${money(write.purchaseAfter)})${main}`;
}

export function scaleFailedText(reason: string): string {
  return `${reason}. Both budgets are as they were.`;
}

export function copyAppliedText(source: string): string {
  return `${source} · Purchase is live`;
}

/** F3 for a Purchase campaign: what's judged when (PC6). */
export function purchaseJudgedText(applied: { startedOn: string; endDay: string } | null, step: { appliedOn: string; direction: "up" | "down" } | null): string | null {
  if (!applied) return null;
  const end = addDaysIso(applied.startedOn, 13) < applied.endDay ? addDaysIso(applied.startedOn, 13) : applied.endDay;
  const span = applied.startedOn.slice(0, 7) === end.slice(0, 7) ? `${Number(applied.startedOn.slice(8))}–${Number(end.slice(8))} ${shortDay(end).split(" ")[2]}` : `${shortDay(applied.startedOn).slice(4)}–${shortDay(end).slice(4)}`;
  const first = `The Purchase line is judged on ${span} (its first 14 days), with which pick won`;
  if (!step) return `${first}.`;
  const weekday = new Date(`${step.appliedOn}T12:00:00Z`).getUTCDay();
  const monday = addDaysIso(step.appliedOn, weekday === 1 ? 0 : (8 - weekday) % 7);
  return `${first}; the step ${step.direction} on the week to ${shortDay(addDaysIso(monday, 6))}.`;
}

// ── HP4: the running Purchase campaign, from the event's applied lines ───────

type AppliedLine = { kind: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null; applied_at: string | null };

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const londonDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** The refresh-made Purchase campaign of an event (its applied Purchase campaign line), with its last step and its copies; null when there's none. */
export function runningFrom(lines: readonly AppliedLine[]): (PurchaseRunning & { endDay: string; customConversionId: string | null }) | null {
  const purchase = lines.filter((line) => line.kind === "purchase_campaign" && line.applied_at).sort((x, y) => (x.applied_at! < y.applied_at! ? 1 : -1))[0];
  const progress = (purchase?.applied_result?.purchase ?? (purchase?.applied_result?.previous as Record<string, unknown> | undefined)?.purchase) as { campaignId?: string; rate?: number; customConversionId?: string; adSets?: Record<string, { id: string; role: string; name: string }> } | undefined;
  const write = purchase?.write ?? {};
  if (!purchase || !progress?.campaignId) return null;
  const steps = lines.filter((line) => line.kind === "scale_purchase" && line.applied_at && line.write?.purchaseCampaignId === progress.campaignId).sort((x, y) => (x.applied_at! < y.applied_at! ? 1 : -1));
  const copies = lines.filter((line) => line.kind === "copy_audience" && line.write?.purchaseCampaignId === progress.campaignId);
  const picks = (Array.isArray(write.picks) ? write.picks : []) as { adsetId?: string; name?: string }[];
  const ads = (Array.isArray(write.ads) ? write.ads : []) as { adId?: string; name?: string }[];
  return {
    campaignId: progress.campaignId,
    campaignName: str(write.campaignName) ?? "Purchase",
    mainCampaignId: str(write.mainCampaignId),
    mainCampaignKey: str(write.mainCampaignKey) ?? "",
    mainShort: str(write.mainShort) ?? "the main campaign",
    startedOn: londonDay(purchase.applied_at!),
    lastStepOn: steps[0]?.applied_at ? londonDay(steps[0].applied_at) : null,
    rate: Number(steps[0]?.write?.toRate) || Number(progress.rate) || Number(write.dailyGbp) || 5,
    copied: {
      ids: [...Object.keys(progress.adSets ?? {}), ...picks.map((pick) => pick.adsetId ?? ""), ...copies.map((line) => str(line.write?.sourceAdsetId) ?? "")].filter(Boolean),
      names: [...picks.map((pick) => pick.name ?? ""), ...copies.map((line) => str(line.write?.sourceName) ?? "")].filter(Boolean),
    },
    ads: ads.filter((ad) => ad.adId).map((ad) => ({ adId: ad.adId!, name: ad.name ?? ad.adId! })),
    pixelId: str(write.pixelId) ?? "",
    path: write.path === "own_domain" ? "own_domain" : "platform",
    endDay: str(write.endDay) ?? "",
    customConversionId: progress.customConversionId ?? null,
  };
}
