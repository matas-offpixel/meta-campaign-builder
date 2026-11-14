/**
 * P4 PR C — Apply for Scale Purchase and Copy an audience into Purchase
 * (docs/design-record/2026-11-14-purchase-campaigns.html, PC4, PC5, HP4).
 *
 * Scale Purchase moves lifetime between the Purchase campaign and the main
 * campaign through R4's lifetime_budget write, behind
 * ONSALE_REFRESH_LIFETIME_BUDGET_WRITES_ENABLED (the cross-campaign move
 * gate, default off). The write order:
 *   up:   the main campaign lowered first, then Purchase raised;
 *   down: Purchase lowered first, then the main campaign raised.
 * If the second write fails, the first is put back and the line reads
 * "Failed — {reason}. Both budgets are as they were." Each side is checked
 * against what the proposal read (changed in Ads Manager = nothing written),
 * the main campaign's floor and this refresh's 20 % cap again at apply time.
 *
 * Copy an audience builds one ad set in the live Purchase campaign by PC3's
 * rules (the source exactly, Purchase, no budget, the reused ads), behind the
 * campaign-create gate: made paused, its ads, then switched on. No money moves.
 *
 * Meta is passed in (the apply route wires it); every write goes through
 * meta_write_idempotency keyed on the line.
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { campaignCreateEnabled, lifetimeBudgetWritesEnabled, purchaseAdSetPayload, reuseAd, type PurchaseMeta } from "./apply-purchase.ts";
import { campaignFloor, ceilPenny, floorBracket, money, PC } from "./purchase-campaign.ts";
import { copyAppliedText, scaleAppliedText, scaleFailedText, type ScaleWrite } from "./purchase-scale.ts";

type Outcome = { state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> };

export type ScaleDeps = {
  env: Record<string, string | undefined>;
  meta: Pick<PurchaseMeta, "readCampaignBudget" | "updateCampaign">;
  plan: { budget: number | null; spend: number; appliedMovesGbp: number };
  /** Spend to date now (ad_daily_insights), £. */
  mainSpentNow: number;
  purchaseSpentNow: number;
};

export const SCALE_SWITCHED_OFF = "Moving budget between campaigns is switched off on this deployment, so nothing was moved";

const round2 = (value: number) => Math.round(value * 100) / 100;
const minor = (gbp: number) => Math.round(gbp * 100);

export async function applyScalePurchase(deps: ScaleDeps, line: { id: string; write: Record<string, unknown> | null }, ctx: { ledger: MetaWriteContext; plainMetaReason: (err: unknown) => string }): Promise<Outcome> {
  const write = (line.write ?? {}) as unknown as ScaleWrite & { mainShort?: string };
  const short = write.mainShort ?? "the main campaign";
  const fail = (reason: string, extra: Record<string, unknown> = {}): Outcome => ({ state: "failed", reason: scaleFailedText(reason), result: extra });
  if (write.kind !== "purchase_scale" || !write.purchaseCampaignId) return { state: "failed", reason: "The line has nothing to move.", result: {} };
  if (!lifetimeBudgetWritesEnabled(deps.env)) return fail(SCALE_SWITCHED_OFF);
  const touchesMain = write.mainCampaignId != null && write.move !== 0;
  let purchaseNow: number | null;
  let mainNow: number | null = null;
  try {
    purchaseNow = ((await deps.meta.readCampaignBudget(write.purchaseCampaignId)).lifetime ?? 0) / 100;
    if (touchesMain) mainNow = ((await deps.meta.readCampaignBudget(write.mainCampaignId!)).lifetime ?? 0) / 100;
  } catch (err) {
    return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "read" });
  }
  // Already done (a Retry after both writes landed): nothing to do.
  if (Math.abs(purchaseNow - write.purchaseAfter) < 0.005 && (!touchesMain || Math.abs(mainNow! - (write.mainAfter ?? 0)) < 0.005)) {
    return { state: "applied", reason: scaleAppliedText(write, short), result: { purchase: { before: write.purchaseBefore, after: write.purchaseAfter }, main: { before: write.mainBefore, after: write.mainAfter } } };
  }
  if (Math.abs(purchaseNow - write.purchaseBefore) >= 0.005) return fail("The Purchase campaign's budget changed in Ads Manager since the proposal");
  if (touchesMain && Math.abs(mainNow! - (write.mainBefore ?? 0)) >= 0.005) return fail(`${short}'s budget changed in Ads Manager since the proposal`);
  if (write.direction === "up") {
    const extra = round2(write.headroom + write.move);
    const capBase = deps.plan.budget != null ? Math.max(0, deps.plan.budget - deps.plan.spend) : Math.max(0, (write.mainBefore ?? 0) - deps.mainSpentNow);
    const cap = round2(capBase * PC.capShare - deps.plan.appliedMovesGbp);
    if (extra > cap + 1e-9) return fail(`${money(extra)} is over this refresh's 20 % cap (${money(Math.max(0, cap))} free)`);
    if (touchesMain) {
      // PC7: the main campaign's floor on today's spend — the larger of spend + 3 days and Meta's 1.1 × spend.
      const floor = campaignFloor(deps.mainSpentNow, write.mainDaily ?? 0);
      if ((write.mainAfter ?? 0) < floor.floor - 1e-9) return fail(`${short} would go under ${money(floor.floor)} ${floorBracket(floor)}`);
    }
  } else if (write.purchaseAfter < ceilPenny(1.1 * deps.purchaseSpentNow) - 1e-9) {
    // PC7: a step down never takes the Purchase campaign under Meta's 1.1 × its own spend.
    return fail(`the Purchase campaign would go under ${money(ceilPenny(1.1 * deps.purchaseSpentNow))} (Meta's minimum: 1.1 × ${money(deps.purchaseSpentNow)} spent)`);
  }
  const sides: { id: string; before: number; after: number }[] = [];
  if (write.direction === "up") {
    if (touchesMain) sides.push({ id: write.mainCampaignId!, before: write.mainBefore!, after: write.mainAfter! });
    sides.push({ id: write.purchaseCampaignId, before: write.purchaseBefore, after: write.purchaseAfter });
  } else {
    sides.push({ id: write.purchaseCampaignId, before: write.purchaseBefore, after: write.purchaseAfter });
    if (touchesMain) sides.push({ id: write.mainCampaignId!, before: write.mainBefore!, after: write.mainAfter! });
  }
  const done: typeof sides = [];
  for (const side of sides) {
    try {
      await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_lifetime_budget_update", { line_id: line.id, campaign_id: side.id, lifetime_budget: minor(side.after) }, async () => {
        await deps.meta.updateCampaign(side.id, { lifetime_budget: minor(side.after) });
        return side.id;
      }, { required: true });
      done.push(side);
    } catch (err) {
      // PC4: the first write is put back, so both budgets are as they were.
      const putBack: { id: string; ok: boolean }[] = [];
      for (const first of done) {
        try {
          await deps.meta.updateCampaign(first.id, { lifetime_budget: minor(first.before) });
          putBack.push({ id: first.id, ok: true });
        } catch {
          putBack.push({ id: first.id, ok: false });
        }
      }
      const reason = ctx.plainMetaReason(err);
      if (putBack.some((row) => !row.ok)) return { state: "failed", reason: `${reason}. The first budget couldn't be put back: check it in Ads Manager.`, result: { done, putBack, error: err instanceof Error ? err.message : String(err) } };
      return fail(reason, { done, putBack, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { state: "applied", reason: scaleAppliedText(write, short), result: { purchase: { before: write.purchaseBefore, after: write.purchaseAfter }, main: { before: write.mainBefore, after: write.mainAfter } } };
}

export type CopyDeps = { env: Record<string, string | undefined>; meta: Pick<PurchaseMeta, "readAdSetForCopy" | "readAd" | "createAdSet" | "createAd" | "createCreativeFromPost" | "setAdSetActive"> };

export const COPY_SWITCHED_OFF = "Building into the Purchase campaign is switched off on this deployment, so nothing was copied.";

export async function applyCopyAudience(deps: CopyDeps, line: { id: string; write: Record<string, unknown> | null }, ctx: { ledger: MetaWriteContext; adAccountId: string; plainMetaReason: (err: unknown) => string }): Promise<Outcome> {
  const write = line.write ?? {};
  const source = typeof write.sourceAdsetId === "string" ? write.sourceAdsetId : null;
  const campaignId = typeof write.purchaseCampaignId === "string" ? write.purchaseCampaignId : null;
  const name = typeof write.sourceName === "string" ? write.sourceName : "the ad set";
  if (write.kind !== "purchase_copy_audience" || !source || !campaignId || typeof write.pixelId !== "string" || typeof write.endDay !== "string") return { state: "failed", reason: "The line has nothing to copy.", result: {} };
  if (!campaignCreateEnabled(deps.env)) return { state: "failed", reason: COPY_SWITCHED_OFF, result: {} };
  const ads = (Array.isArray(write.ads) ? write.ads : []) as { adId: string; name: string }[];
  let adsetId: string | null = null;
  try {
    const src = await deps.meta.readAdSetForCopy(source);
    if (!src) return { state: "failed", reason: `The ad set it copies (${name}) can't be read.`, result: {} };
    const payload = purchaseAdSetPayload(src, { campaignId, pixelId: write.pixelId, customConversionId: typeof write.customConversionId === "string" ? write.customConversionId : null, endDay: write.endDay, name });
    adsetId = await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_create", { line_id: line.id, source }, () => deps.meta.createAdSet(ctx.adAccountId, payload), { required: true });
    const adIds: string[] = [];
    for (const ad of ads) {
      const live = await deps.meta.readAd(ad.adId);
      if (!live?.creativeId) continue;
      // PC9: the creative id, else one new creative from the same post.
      adIds.push((await reuseAd(deps.meta, ctx.ledger, { lineId: line.id, adAccountId: ctx.adAccountId, adsetId: adsetId!, creative: { name: live.name || ad.name, creativeId: live.creativeId, objectStoryId: live.objectStoryId ?? null } })).adId);
    }
    await withMetaWriteIdempotency(ctx.ledger, "adset_status_update", { line_id: line.id, adset_id: adsetId, status: "ACTIVE" }, async () => {
      await deps.meta.setAdSetActive(adsetId!);
      return adsetId!;
    }, { required: true });
    return { state: "applied", reason: copyAppliedText(name), result: { adsetId, adIds } };
  } catch (err) {
    return { state: "failed", reason: adsetId ? `${ctx.plainMetaReason(err)}. Made paused: the ad set.` : ctx.plainMetaReason(err), result: { adsetId, error: err instanceof Error ? err.message : String(err) } };
  }
}
