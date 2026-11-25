/**
 * "Create {m} audiences in {account}": what it makes, and its gate. The write
 * path is a mock: no test here reaches Meta or the database.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOUSE_DISCO,
  RC_E_DATA,
  RC_E_EVENT,
  RC_E_KNOWN,
  RC_E_PENDING,
  RC_E_PICKS,
  SU_C_HELD_DATA,
  SU_C_HELD_TEMPLATE,
} from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
import { createItems, createPlan, createTargets, runTemplateCreate, type CreateInsert, type CreatePlanRow } from "../create.ts";
import { resolveTemplate, type TemplateItem } from "../resolve.ts";
import { pickFor } from "../videos.ts";

const sheffield = resolveTemplate(SU_C_HELD_TEMPLATE.items, SU_C_HELD_DATA.accountId, SU_C_HELD_DATA.known, SU_C_HELD_DATA.pixelId);
const targets = createTargets(sheffield.items, SU_C_HELD_DATA.pixelId);
const opts = { userId: "u1", clientId: "c1", accountId: SU_C_HELD_DATA.accountId, pixelId: SU_C_HELD_DATA.pixelId, template: "House & disco" };
const plan = createPlan(targets, opts);
const picked = (it: TemplateItem) => pickFor(RC_E_PICKS, "House & disco", it, RC_E_EVENT);
const label = (t: (typeof targets)[number]) =>
  t.kind === "pixel" ? `pixel ${t.pixelEvent} ${t.retentionDays}` : t.kind === "page" ? `page ${t.subtype} ${t.pageId} ${t.retentionDays}` : `video ${t.threshold} ${t.retentionDays}`;

describe("what Create makes", () => {
  it("pixel pools and page engagers; no list, no show's list, no interests, and no video viewers without videos", () => {
    assert.deepEqual(targets.map(label), [
      "pixel PageView 30",
      "pixel CompleteRegistration 180",
      "page page_engagement_fb 756330917740654 365",
      "page page_engagement_ig 756330917740654 365",
      "page page_engagement_fb 269098466834722 365",
      "page page_engagement_ig 269098466834722 365",
    ]);
    assert.equal(createItems(targets).length, 4, "a page is one item");
  });

  it("never an item without video ids: no pick, a pick with no videos, or a pick with no page", () => {
    const nx = resolveTemplate(HOUSE_DISCO.items, RC_E_DATA.accountId, RC_E_KNOWN, RC_E_DATA.pixelId);
    assert.deepEqual(createTargets(nx.items, RC_E_DATA.pixelId), []);
    for (const bad of [{ ...RC_E_PICKS[0]!, videoIds: [] }, { ...RC_E_PICKS[0]!, contextId: undefined }, { ...RC_E_PICKS[0]!, videoIds: ["x1"] }]) {
      assert.deepEqual(createTargets(nx.items, RC_E_DATA.pixelId, () => bad), [], JSON.stringify(bad));
    }
    // And no row of any plan is a video audience without ids.
    const withVideos = createPlan(createTargets(nx.items, RC_E_DATA.pixelId, picked), opts);
    for (const p of [...plan, ...withVideos]) {
      if (p.row.audienceSubtype === "video_views") assert.ok((p.row.sourceMeta.videoIds as string[]).length > 0 && p.row.sourceId.length > 0);
    }
  });

  it("with this show's videos picked: one video row, the item's threshold and days, the show's event", () => {
    const nx = resolveTemplate(HOUSE_DISCO.items, RC_E_DATA.accountId, RC_E_KNOWN, RC_E_DATA.pixelId);
    const rows = createPlan(createTargets(nx.items, RC_E_DATA.pixelId, picked), { ...opts, accountId: RC_E_DATA.accountId, pixelId: RC_E_DATA.pixelId });
    assert.deepEqual(rows, [
      {
        item: 0,
        row: {
          userId: "u1",
          clientId: "c1",
          metaAdAccountId: RC_E_DATA.accountId,
          eventId: RC_E_EVENT.eventId,
          name: "[House & disco] NX26-LOCKLEAD video 50% 30d",
          funnelStage: "bottom_funnel",
          audienceSubtype: "video_views",
          retentionDays: 30,
          sourceId: "1200000000000001,1200000000000002,1200000000000003",
          sourceMeta: {
            subtype: "video_views",
            threshold: 50,
            videoIds: ["1200000000000001", "1200000000000002", "1200000000000003"],
            contextId: "756330917740654",
            campaignId: "120200000000001",
            campaignIds: ["120200000000001"],
          },
        },
      },
    ]);
  });

  it("only the platforms the account lacks", () => {
    const nx = resolveTemplate([...HOUSE_DISCO.items, ...RC_E_PENDING], RC_E_DATA.accountId, RC_E_KNOWN, RC_E_DATA.pixelId);
    const t = createTargets(nx.items, RC_E_DATA.pixelId);
    assert.deepEqual(t.map(label), ["page page_engagement_fb 1000000000000003 365", "page page_engagement_ig 1000000000000003 365"]);
  });

  it("no pixel, no pixel pools", () => {
    assert.equal(createTargets(sheffield.items, null).filter((t) => t.kind === "pixel").length, 0);
  });

  it("the rows are the builder's own shapes, in the draft's account", () => {
    assert.deepEqual(plan[0]!.row, {
      userId: "u1",
      clientId: "c1",
      metaAdAccountId: SU_C_HELD_DATA.accountId,
      eventId: null,
      name: "[House & disco] PageView 30d",
      funnelStage: "bottom_funnel",
      audienceSubtype: "website_pixel",
      retentionDays: 30,
      sourceId: SU_C_HELD_DATA.pixelId,
      sourceMeta: { subtype: "website_pixel", pixelEvent: "PageView", urlContains: [] },
    });
    assert.deepEqual(plan[2]!.row.sourceMeta, { subtype: "page_engagement_fb", pageName: "Folamour", pageIds: ["756330917740654"] });
    assert.deepEqual(plan.map((p) => p.item), [0, 1, 2, 2, 3, 3]);
  });
});

describe("Create's gate (mocked write path)", () => {
  function mocks(failRows: number[] = []) {
    const calls = { inserted: [] as CreateInsert[][], batches: [] as string[][] };
    return {
      calls,
      insertDrafts: async (rows: CreateInsert[]) => {
        calls.inserted.push(rows);
        return rows.map((_, i) => ({ id: `draft-${i}` }));
      },
      createBatch: async (ids: string[]) => {
        calls.batches.push(ids);
        const failed = new Set(failRows.map((i) => `draft-${i}`));
        return { successes: ids.filter((id) => !failed.has(id)).map((id) => ({ audienceId: id })), failures: ids.filter((id) => failed.has(id)) };
      },
    };
  }

  it("writes off: nothing is written, not even a draft row", async () => {
    const m = mocks();
    assert.deepEqual(await runTemplateCreate({ writesEnabled: false, confirmed: true, plan, ...m }), { ok: false, reason: "writes_off" });
    assert.equal(m.calls.inserted.length + m.calls.batches.length, 0);
  });

  it("an unconfirmed template: nothing is written", async () => {
    const m = mocks();
    assert.deepEqual(await runTemplateCreate({ writesEnabled: true, confirmed: false, plan, ...m }), { ok: false, reason: "unconfirmed" });
    assert.equal(m.calls.inserted.length + m.calls.batches.length, 0);
  });

  it("writes on: the rows, then one batch through the write path; counts are Meta audiences", async () => {
    const m = mocks();
    assert.deepEqual(await runTemplateCreate({ writesEnabled: true, confirmed: true, plan, ...m }), { ok: true, created: 6, failed: 0 });
    assert.equal(m.calls.inserted[0]!.length, 6);
    assert.deepEqual(m.calls.batches, [["draft-0", "draft-1", "draft-2", "draft-3", "draft-4", "draft-5"]]);
  });

  it("each audience not made is counted, for Try again", async () => {
    // Row 3 is Folamour's Instagram audience.
    assert.deepEqual(await runTemplateCreate({ writesEnabled: true, confirmed: true, plan, ...mocks([3]) }), { ok: true, created: 5, failed: 1 });
  });

  it("nothing to create: no call", async () => {
    const m = mocks();
    const empty: CreatePlanRow[] = [];
    assert.deepEqual(await runTemplateCreate({ writesEnabled: true, confirmed: true, plan: empty, ...m }), { ok: false, reason: "nothing_to_create" });
    assert.equal(m.calls.inserted.length, 0);
  });
});
