/**
 * "On sale" for retargeting is the on-sale panel's rule (Matas, 27 Nov):
 * lib/onsale-refresh/on-sale.ts isOnSale — status on_sale or the general sale
 * date passed, the show still ahead, not cancelled. AS26-TOR and
 * DHB26-TRANCOSO (on sale by status, no sale dates stored) read "it isn't on
 * sale" in the 27 Nov dry run; they plan now. Presale is as before, except a
 * show the panel calls on sale is on sale.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { isOnSale } from "../../onsale-refresh/on-sale.ts";
import { isPresale } from "../funnel-plan.ts";
import { planRetargeting, type RetargetingInput } from "../plan.ts";

const TODAY = "2026-11-27";

/** A show the way the read builds its input; `event` gives the on-sale fields, onSale is isOnSale's answer as the runner sets it. */
function input(code: string, event: { status: string; event_date: string; general_sale_at: string | null; presale_at?: string | null }, over: Partial<RetargetingInput> = {}): RetargetingInput {
  return {
    onSale: isOnSale(event, TODAY),
    eventId: code.toLowerCase(),
    eventCode: code,
    runDay: TODAY,
    eventDate: event.event_date,
    onSaleDay: (event.presale_at || event.general_sale_at)?.slice(0, 10) ?? null,
    announceDay: null,
    read: { state: "platform_under_bar", pixel: { id: "px1" }, pixelName: "Pixel", platform: "Skiddle", domain: null } as never,
    last7SpendGbp: 200,
    minDailyMinor: null,
    sources: {
      pixelId: "px1",
      links: [
        { kind: "ticket", rule: "skiddle.com/e/1", host: "skiddle.com", name: "Skiddle", platform: "skiddle" },
        { kind: "landing", rule: "crqln.com/l/x", host: "crqln.com", name: "crqln.com/l/x", platform: null },
      ],
      videos: [],
      pages: [{ id: "500100", name: "Promoter", igId: null, kind: "promoter", hasRole: true }],
      lists: [],
    },
    existing: null,
    legacy: [],
    budgetGbp: null,
    spendToDateGbp: 0,
    committedGbp: null,
    main: null,
    ads: [{ adId: "7001", name: "on sale" }],
    geoFromAdsetId: "5001",
    where: { draftId: "d1", adAccountId: "act_1", campaignIds: ["4001"] },
    prospecting: [{ id: "as1", kind: "adset", name: "Broad", dailyMinor: 4000, adSets: 1 }],
    twoCampaigns: true,
    linksRead: "ok",
    ...over,
  };
}

describe("on sale is the on-sale panel's isOnSale", () => {
  it("AS26-TOR and DHB26-TRANCOSO shapes (status on_sale, no sale dates, the show ahead) plan", () => {
    for (const code of ["AS26-TOR", "DHB26-TRANCOSO"]) {
      const plan = planRetargeting(input(code, { status: "on_sale", event_date: "2027-01-24", general_sale_at: null }));
      assert.equal(plan.state, "proposed", code);
      assert.ok(plan.build, code);
    }
  });

  it("a cancelled show doesn't, and a past show doesn't", () => {
    assert.equal(planRetargeting(input("XMPL-GONE", { status: "cancelled", event_date: "2027-01-24", general_sale_at: "2026-10-01" })).state, "before_onsale");
    assert.equal(isOnSale({ status: "on_sale", event_date: "2026-11-20", general_sale_at: "2026-10-01" }, TODAY), false);
    assert.equal(planRetargeting(input("XMPL-PAST", { status: "on_sale", event_date: "2026-11-20", general_sale_at: null })).state, "before_onsale");
  });

  it("a show the panel calls on sale is on sale, even when its dates look like presale", () => {
    // Announced, a general sale date still ahead, but the status says on sale.
    const shape = { status: "on_sale", event_date: "2027-02-13", general_sale_at: "2026-12-04" };
    const i = input("XMPL-CELLAR", shape, { announceDay: "2026-11-23" });
    assert.equal(isPresale(i), false);
    assert.equal(isPresale({ ...i, onSale: false }), true);
    const plan = planRetargeting(i);
    assert.equal(plan.state, "proposed");
    assert.equal((plan.build as { presale?: boolean }).presale, false);
  });

  it("with no on-sale answer, the sale dates decide as before", () => {
    assert.equal(planRetargeting(input("XMPL-SOON", { status: "announced", event_date: "2027-01-24", general_sale_at: "2026-12-10" }, { onSale: undefined })).state, "before_onsale");
    assert.equal(planRetargeting(input("XMPL-ON", { status: "announced", event_date: "2027-01-24", general_sale_at: "2026-11-01" }, { onSale: undefined })).state, "proposed");
  });
});
