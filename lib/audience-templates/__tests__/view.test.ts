/**
 * The tab's view of RC-E's fixture: header, groups in the record's order,
 * the item lines, the footer and the change line.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KnownAudience, TemplateItem } from "../resolve.ts";
import {
  HOUSE_DISCO,
  RC_E_DATA,
  RC_E_KNOWN,
  RC_E_PENDING,
  SU_C_DATA,
  SU_C_HELD_DATA,
  SU_C_HELD_TEMPLATE,
  SU_C_TEMPLATE,
  TECHNO,
  RC_E_EVENT,
  RC_E_PICKS,
} from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
import { pickFor } from "../videos.ts";
import type { TemplateVideoPick } from "../../types.ts";
import { buildTemplateView, pageItem, shortDate } from "../view.ts";

const ctx = {
  accountId: RC_E_DATA.accountId,
  accountName: RC_E_DATA.accountName,
  pixelId: RC_E_DATA.pixelId,
  pixelName: RC_E_DATA.pixelName,
  writesEnabled: false,
  confirmerName: (id: string) => RC_E_DATA.confirmerNames[id] ?? null,
};

describe("buildTemplateView (RC-E)", () => {
  const view = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, ctx, RC_E_PENDING);

  it("the header reads as the frame's", () => {
    assert.equal(view.header.forLine, "For house_tech + disco shows: Locklead, Ewan McVicar, Folamour, Robbie Doherty, Julian Fijma");
    assert.equal(view.header.confirmedLine, "confirmed by Matas Tue 24 Nov");
    assert.equal(view.header.accountLine, "in NX Promoter");
  });

  it("groups come in the record's order with the frame's lines", () => {
    assert.deepEqual(view.groups.map((g) => g.label), ["Customer lists", "Retargeting pools", "Artist page engagers", "Interests"]);
    const rows = view.groups.flatMap((g) => g.rows.map((r) => `${r.title} | ${r.line} | ${r.statusLabel}`));
    assert.deepEqual(rows, [
      "Tech house buyers | Customer list · role: buyers, house_tech | Reused",
      "Disco buyers | Customer list · role: buyers, disco | Reused",
      "Page views | NX Loves pixel · 30 days | Reused",
      "Signups | NX Loves pixel · 180 days | Reused",
      "Video viewers | 50% watched · 30 days | Needs videos",
      "Folamour | Facebook + Instagram · 365 days | Reused",
      "Robbie Doherty | Facebook + Instagram · 365 days | Reused",
      "Ewan McVicar | Facebook + Instagram · 365 days | Will be created",
      "House music · Disco · Defected Records | 3 interests | Reused",
    ]);
  });

  it("the footer counts Meta audiences: the interests row is 1, a page on both platforms 2", () => {
    assert.equal(view.reused, 9, "lists 2, pools 2, Folamour 2, Robbie Doherty 2, interests 1");
    assert.equal(view.toCreate, 2, "Ewan McVicar: Facebook + Instagram");
    assert.equal(view.needVideos, 1);
    assert.equal(view.leftOut, 3);
    assert.equal(view.footer, "9 reused · 2 will be created in NX Promoter · 1 needs videos picked. Creating audiences is switched off, so these 2 wait.");
    assert.equal(
      buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, writesEnabled: true }, RC_E_PENDING).footer,
      "9 reused · 2 will be created in NX Promoter · 1 needs videos picked",
    );
  });

  it("an added page is a change until saved; a page already in the template isn't", () => {
    assert.equal(view.changed, "1 change since this template was saved");
    assert.equal(view.canSave, true);
    const none = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, ctx, [pageItem("756330917740654", "Folamour")]);
    assert.equal(none.changed, null);
    assert.equal(none.canSave, false);
    const two = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, ctx, [...RC_E_PENDING, pageItem("1000000000000004", "Kirollus")]);
    assert.equal(two.changed, "2 changes since this template was saved");
  });

  it("an unconfirmed template has no confirmed line", () => {
    const v = buildTemplateView(TECHNO, [], ctx);
    assert.equal(v.header.confirmed, false);
    assert.equal(v.header.confirmedLine, null);
    assert.equal(v.header.forLine, "For techno + hard_techno + melodic_prog shows: AZYR, Schak");
  });

  it("dates read like the frame, in London", () => {
    assert.equal(shortDate("2026-11-24T12:00:00Z"), "Tue 24 Nov");
    assert.equal(shortDate("2026-11-24T23:30:00Z"), "Tue 24 Nov");
  });

  it("with no pixel name, the pixel reads by its last four", () => {
    const v = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, pixelName: null });
    assert.equal(v.groups[1]!.rows[0]!.line, "…2763 pixel · 30 days");
  });

  describe("a customer list held in another account (templates.item.held)", () => {
    const BRISTOL = "act_2011069725849568";
    const heldList: TemplateItem = {
      kind: "customer_list",
      listRole: "buyers",
      familyKey: "house_tech",
      pageId: null,
      retentionDays: null,
      interestId: null,
      interestName: null,
      metaAudienceId: "9100000000000001",
      detail: { name: "Tech House Data", heldIn: BRISTOL },
    };
    const t = { ...HOUSE_DISCO, items: [heldList] };
    const inBristol: KnownAudience = { source: "meta", metaAudienceId: "9100000000000001", accountId: BRISTOL, subtype: "customer_list", listRole: null, familyKey: "house_tech" };
    const named = { ...ctx, accountLabel: (id: string) => (id === BRISTOL ? "Electric Bristol Live" : null) };

    it("the line says where it's held, after the list's own line, and replaces Will be created", () => {
      const v = buildTemplateView(t, [inBristol], named);
      const row = v.groups[0]!.rows[0]!;
      assert.equal(row.line, "Customer list · role: buyers, house_tech · held in Electric Bristol Live");
      assert.equal(row.status, "held");
      assert.equal(row.statusLabel, "");
    });

    it("isn't counted as created: nothing is re-uploaded", () => {
      const v = buildTemplateView(t, [inBristol], named);
      assert.equal(v.held, 1);
      assert.equal(v.toCreate, 0);
      assert.equal(v.metaCreates, 0);
      assert.equal(v.footer, "0 reused · 1 held in Electric Bristol Live");
    });

    it("reads Reused once it's shared to the target", () => {
      const v = buildTemplateView(t, [inBristol, { ...inBristol, accountId: ctx.accountId }], named);
      const row = v.groups[0]!.rows[0]!;
      assert.equal(row.status, "reused");
      assert.equal(row.line, "Customer list · role: buyers, house_tech");
      assert.equal(v.held, 0);
    });

    it("without a stored name it reads the account id", () => {
      const v = buildTemplateView(t, [inBristol], ctx);
      assert.equal(v.groups[0]!.rows[0]!.line, `Customer list · role: buyers, house_tech · held in ${BRISTOL}`);
    });

    it("a list held in the target itself is never 'held in'", () => {
      const own = { ...HOUSE_DISCO, items: [{ ...heldList, detail: { name: "Tech House Data", heldIn: ctx.accountId } }] };
      const row = buildTemplateView(own, [], named).groups[0]!.rows[0]!;
      assert.equal(row.status, "create");
      assert.equal(row.statusLabel, "Will be created");
    });

    it("RC-E draws no held line: its lists are reused in NX Promoter", () => {
      const v = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, named, RC_E_PENDING);
      assert.equal(v.held, 0);
      assert.ok(v.groups.every((g) => g.rows.every((r) => !r.line.includes("held in"))));
    });
  });

describe("SU2: shows' Signups lists in the tab (SU-C, SU-C-held)", () => {
  it("a show's list not made yet is never another show's list", () => {
    const v = buildTemplateView(SU_C_TEMPLATE, SU_C_DATA.known, ctx);
    assert.ok(!v.resolved.items.find((r) => r.item.detail.code === "NX27-SILVABUMPA")!.reusedIds.length);
  });

  it("SU-C: after the genre lists, the made list Reused with its count, the other Made on its day", () => {
    const v = buildTemplateView(SU_C_TEMPLATE, SU_C_DATA.known, ctx);
    assert.deepEqual(
      v.groups[0]!.rows.map((r) => `${r.title} | ${r.line} | ${r.statusLabel}`),
      [
        "Tech house buyers | Customer list · role: buyers, house_tech | Reused",
        "Disco buyers | Customer list · role: buyers, disco | Reused",
        "NX27-GLITTERBOX · Signups | Customer list · role: signups · NX27-GLITTERBOX · 1,204 signups | Reused",
        // The record writes "Thu 27 Nov"; 27 Nov 2026 is a Friday, and the date is read from the presale.
        "NX27-SILVABUMPA · Signups | Customer list · role: signups · NX27-SILVABUMPA | Made on Fri 27 Nov",
      ],
    );
    assert.equal(v.groups[0]!.rows[3]!.status, "waiting");
  });

  it("a waiting list is never Will be created, and Create never counts it", () => {
    const v = buildTemplateView(SU_C_TEMPLATE, SU_C_DATA.known, ctx);
    assert.equal(v.waiting, 1);
    // Only video viewers are left, with no videos picked: no create part, Create hidden.
    assert.equal(v.toCreate, 0);
    assert.equal(v.createCount, 0);
    assert.equal(v.needVideos, 1);
    assert.equal(v.footer, "10 reused · 1 needs videos picked");
  });

  it("SU-C-held: in Sheffield every list reads held in NX Promoter, the waiting list still Made on", () => {
    const held = { ...ctx, accountId: SU_C_HELD_DATA.accountId, accountName: SU_C_HELD_DATA.accountName, pixelId: SU_C_HELD_DATA.pixelId, pixelName: SU_C_HELD_DATA.pixelName, accountLabel: (id: string) => SU_C_HELD_DATA.accountNames[id] ?? null };
    const v = buildTemplateView(SU_C_HELD_TEMPLATE, SU_C_HELD_DATA.known, held);
    assert.deepEqual(
      v.groups[0]!.rows.map((r) => `${r.line} | ${r.status}`),
      [
        "Customer list · role: buyers, house_tech · held in NX Promoter | held",
        "Customer list · role: buyers, disco · held in NX Promoter | held",
        "Customer list · role: signups · NX27-GLITTERBOX · 1,204 signups · held in NX Promoter | held",
        "Customer list · role: signups · NX27-SILVABUMPA | waiting",
      ],
    );
    assert.equal(v.held, 3);
    assert.equal(v.reused, 1, "the interests row");
    assert.equal(v.toCreate, 6, "two pools, two pages on both platforms");
    assert.equal(v.createCount, 6);
    assert.equal(v.addCount, 1);
    assert.equal(v.footer, "1 reused · 6 will be created in Electric Studios Sheffield · 3 held in NX Promoter · 1 needs videos picked. Creating audiences is switched off, so these 6 wait.");
  });
});


  describe("video-viewer items (record 2026-11-25-signups-into-meta, RC-E before and after)", () => {
    const picks = (list: TemplateVideoPick[]) => (it: TemplateItem) => pickFor(list, "House & disco", it, RC_E_EVENT);
    const before = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, picks: picks([]) }, RC_E_PENDING);
    const after = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, picks: picks(RC_E_PICKS) }, RC_E_PENDING);
    const video = (v: ReturnType<typeof buildTemplateView>) => v.groups[1]!.rows.find((r) => r.title === "Video viewers")!;

    it("before: Needs videos, the ochre line, Pick this show's videos", () => {
      const r = video(before);
      assert.equal(r.status, "needs_videos");
      assert.equal(r.statusLabel, "Needs videos");
      assert.deepEqual(r.note, { text: "Meta needs this show’s videos, so Create leaves this out until they’re picked.", tone: "ochre" });
      assert.deepEqual(r.videos, { action: "pick", threshold: 50, days: 30 });
      assert.equal(before.footer, "9 reused · 2 will be created in NX Promoter · 1 needs videos picked. Creating audiences is switched off, so these 2 wait.");
      assert.equal(before.createCount, 2);
    });

    it("after: Will be created, n videos picked from the code, Change videos, and Create counts it", () => {
      const r = video(after);
      assert.equal(r.status, "create");
      assert.equal(r.statusLabel, "Will be created");
      assert.deepEqual(r.note, { text: "3 videos picked from NX26-LOCKLEAD", tone: "muted" });
      assert.equal(r.videos?.action, "change");
      assert.equal(after.needVideos, 0);
      assert.equal(after.footer, "9 reused · 3 will be created in NX Promoter. Creating audiences is switched off, so these 3 wait.");
      assert.equal(after.createCount, 3);
    });

    it("a pick for another event, or with no page id, is never used", () => {
      const other = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, picks: (it) => pickFor(RC_E_PICKS, "House & disco", it, { eventId: "another", code: "NX26-OTHER" }) }, RC_E_PENDING);
      assert.equal(video(other).status, "needs_videos");
      const noPage = RC_E_PICKS.map((p) => ({ ...p, contextId: undefined }));
      assert.equal(video(buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, picks: picks(noPage) }, RC_E_PENDING)).status, "needs_videos");
    });

    it("only video viewers left to make: the Create count is 0, so the button hides", () => {
      const v = buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, picks: picks([]) });
      assert.equal(v.createCount, 0);
      assert.equal(v.footer, "9 reused · 1 needs videos picked");
    });
  });

  describe("the footer and Create count the same Meta audiences (one function)", () => {
    const sheffield = { ...ctx, accountId: SU_C_HELD_DATA.accountId, accountName: SU_C_HELD_DATA.accountName, pixelId: SU_C_HELD_DATA.pixelId, pixelName: SU_C_HELD_DATA.pixelName };
    const picked = (it: TemplateItem) => pickFor(RC_E_PICKS, "House & disco", it, RC_E_EVENT);
    const cases: Array<[string, ReturnType<typeof buildTemplateView>]> = [
      ["RC-E", buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, ctx, RC_E_PENDING)],
      ["RC-E picked", buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, picks: picked }, RC_E_PENDING)],
      ["SU-C", buildTemplateView(SU_C_TEMPLATE, SU_C_DATA.known, ctx)],
      ["SU-C picked", buildTemplateView(SU_C_TEMPLATE, SU_C_DATA.known, { ...ctx, picks: picked })],
      ["SU-C-held", buildTemplateView(SU_C_HELD_TEMPLATE, SU_C_HELD_DATA.known, sheffield)],
      ["SU-C-held picked", buildTemplateView(SU_C_HELD_TEMPLATE, SU_C_HELD_DATA.known, { ...sheffield, picks: picked })],
      ["writes on", buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, writesEnabled: true }, RC_E_PENDING)],
      ["video viewers only", buildTemplateView({ ...HOUSE_DISCO, items: HOUSE_DISCO.items.filter((i) => i.listRole === "video_viewers") }, [], ctx)],
    ];
    for (const [name, v] of cases) {
      it(`${name}: toCreate === createCount`, () => assert.equal(v.toCreate, v.createCount));
    }
    it("picking adds exactly the video item to both", () => {
      assert.equal(cases[1]![1].createCount - cases[0]![1].createCount, 1);
      assert.equal(cases[5]![1].createCount - cases[4]![1].createCount, 1);
    });
  });

  describe("templateCounts: one unit, Meta audiences", () => {
    const sheffield = { ...ctx, accountId: SU_C_HELD_DATA.accountId, accountName: SU_C_HELD_DATA.accountName, pixelId: SU_C_HELD_DATA.pixelId, pixelName: SU_C_HELD_DATA.pixelName };
    it("Ewan McVicar on Facebook + Instagram is 2; one platform is 1", () => {
      const ewanOnly = { ...HOUSE_DISCO, items: [] };
      assert.equal(buildTemplateView(ewanOnly, RC_E_KNOWN, ctx, RC_E_PENDING).toCreate, 2);
      // His Facebook audience in this account: only Instagram is left.
      const fbHere: KnownAudience = { source: "row", metaAudienceId: "9100000000000077", accountId: ctx.accountId, subtype: "page_engagement_fb", pageId: "1000000000000003", retentionDays: 365 };
      const v = buildTemplateView(ewanOnly, [...RC_E_KNOWN, fbHere], ctx, RC_E_PENDING);
      assert.equal(v.toCreate, 1);
      assert.equal(v.reused, 1);
    });
    it("the interests row is 1, never one per interest", () => {
      const interests = { ...HOUSE_DISCO, items: HOUSE_DISCO.items.filter((i) => i.kind === "interest") };
      assert.equal(interests.items.length, 3);
      assert.equal(buildTemplateView(interests, [], ctx).reused, 1);
    });
    it("a template with only video viewers: m is 0, so Create hides", () => {
      const v = buildTemplateView({ ...HOUSE_DISCO, items: HOUSE_DISCO.items.filter((i) => i.listRole === "video_viewers") }, [], ctx);
      assert.equal(v.toCreate, 0);
      assert.equal(v.createCount, 0);
      assert.equal(v.needVideos, 1);
      assert.equal(v.footer, "0 reused · 1 needs videos picked");
    });
    it("the held fixture reads 1 reused, 6 to create, 3 held, 1 needing videos", () => {
      const v = buildTemplateView(SU_C_HELD_TEMPLATE, SU_C_HELD_DATA.known, { ...sheffield, accountLabel: (id) => SU_C_HELD_DATA.accountNames[id] ?? null });
      assert.deepEqual([v.reused, v.toCreate, v.held, v.needVideos], [1, 6, 3, 1]);
    });
  });
});

