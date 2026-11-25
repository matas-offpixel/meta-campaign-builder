/**
 * "Create {m} audiences in {account}": what it makes, and its gate. The write
 * path is a mock: no test here reaches Meta or the database.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RC_E_DATA, RC_E_KNOWN, RC_E_PENDING, HOUSE_DISCO, SU_C_HELD_DATA, SU_C_HELD_TEMPLATE } from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
import { createInserts, createTargets, runTemplateCreate, type CreateInsert } from "../create.ts";
import { resolveTemplate } from "../resolve.ts";

const sheffield = resolveTemplate(SU_C_HELD_TEMPLATE.items, SU_C_HELD_DATA.accountId, SU_C_HELD_DATA.known, SU_C_HELD_DATA.pixelId);
const targets = createTargets(sheffield.items, SU_C_HELD_DATA.pixelId);
const inserts = createInserts(targets, { userId: "u1", clientId: "c1", accountId: SU_C_HELD_DATA.accountId, pixelId: SU_C_HELD_DATA.pixelId, template: "House & disco" });

describe("what Create makes", () => {
  it("pixel pools and page engagers only: no list, no show's list, no video viewers, no interests", () => {
    assert.deepEqual(
      targets.map((t) => (t.kind === "pixel" ? `pixel ${t.pixelEvent} ${t.retentionDays}` : `page ${t.subtype} ${t.pageId} ${t.retentionDays}`)),
      [
        "pixel PageView 30",
        "pixel CompleteRegistration 180",
        "page page_engagement_fb 756330917740654 365",
        "page page_engagement_ig 756330917740654 365",
        "page page_engagement_fb 269098466834722 365",
        "page page_engagement_ig 269098466834722 365",
      ],
    );
  });

  it("only the platforms the account lacks", () => {
    const nx = resolveTemplate([...HOUSE_DISCO.items, ...RC_E_PENDING], RC_E_DATA.accountId, RC_E_KNOWN, RC_E_DATA.pixelId);
    const t = createTargets(nx.items, RC_E_DATA.pixelId);
    assert.deepEqual(t.map((x) => (x.kind === "page" ? `${x.subtype} ${x.pageId}` : x.kind)), ["page_engagement_fb 1000000000000003", "page_engagement_ig 1000000000000003"]);
  });

  it("no pixel, no pixel pools", () => {
    assert.equal(createTargets(sheffield.items, null).filter((t) => t.kind === "pixel").length, 0);
  });

  it("the rows are the builder's own shapes, in the draft's account", () => {
    assert.deepEqual(inserts[0], {
      userId: "u1",
      clientId: "c1",
      eventId: null,
      name: "[House & disco] PageView 30d",
      funnelStage: "bottom_funnel",
      audienceSubtype: "website_pixel",
      retentionDays: 30,
      sourceId: SU_C_HELD_DATA.pixelId,
      sourceMeta: { subtype: "website_pixel", pixelEvent: "PageView", urlContains: [] },
      metaAdAccountId: SU_C_HELD_DATA.accountId,
    });
    assert.deepEqual(inserts[2], {
      userId: "u1",
      clientId: "c1",
      eventId: null,
      name: "[House & disco] Folamour FB engagers 365d",
      funnelStage: "top_of_funnel",
      audienceSubtype: "page_engagement_fb",
      retentionDays: 365,
      sourceId: "756330917740654",
      sourceMeta: { subtype: "page_engagement_fb", pageName: "Folamour", pageIds: ["756330917740654"] },
      metaAdAccountId: SU_C_HELD_DATA.accountId,
    });
  });
});

describe("Create's gate (mocked write path)", () => {
  function mocks(failIds: string[] = []) {
    const calls = { inserted: [] as CreateInsert[][], batches: [] as string[][] };
    return {
      calls,
      insertDrafts: async (rows: CreateInsert[]) => {
        calls.inserted.push(rows);
        return rows.map((_, i) => ({ id: `draft-${i}` }));
      },
      createBatch: async (ids: string[]) => {
        calls.batches.push(ids);
        return { successes: ids.filter((id) => !failIds.includes(id)).map((id) => ({ audienceId: id })), failures: ids.filter((id) => failIds.includes(id)) };
      },
    };
  }

  it("writes off: nothing is written, not even a draft row", async () => {
    const m = mocks();
    const res = await runTemplateCreate({ writesEnabled: false, confirmed: true, inserts, ...m });
    assert.deepEqual(res, { ok: false, reason: "writes_off" });
    assert.equal(m.calls.inserted.length, 0);
    assert.equal(m.calls.batches.length, 0);
  });

  it("an unconfirmed template: nothing is written", async () => {
    const m = mocks();
    assert.deepEqual(await runTemplateCreate({ writesEnabled: true, confirmed: false, inserts, ...m }), { ok: false, reason: "unconfirmed" });
    assert.equal(m.calls.inserted.length + m.calls.batches.length, 0);
  });

  it("writes on: the rows, then one batch through the write path", async () => {
    const m = mocks();
    const res = await runTemplateCreate({ writesEnabled: true, confirmed: true, inserts, ...m });
    assert.deepEqual(res, { ok: true, created: 6, failed: 0 });
    assert.equal(m.calls.inserted[0]!.length, 6);
    assert.deepEqual(m.calls.batches, [["draft-0", "draft-1", "draft-2", "draft-3", "draft-4", "draft-5"]]);
  });

  it("a failure is counted, for Try again", async () => {
    const m = mocks(["draft-2", "draft-5"]);
    assert.deepEqual(await runTemplateCreate({ writesEnabled: true, confirmed: true, inserts, ...m }), { ok: true, created: 4, failed: 2 });
  });

  it("nothing to create: no call", async () => {
    const m = mocks();
    assert.deepEqual(await runTemplateCreate({ writesEnabled: true, confirmed: true, inserts: [], ...m }), { ok: false, reason: "nothing_to_create" });
    assert.equal(m.calls.inserted.length, 0);
  });
});
