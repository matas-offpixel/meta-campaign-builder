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
} from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
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
      "Video viewers | 50% watched · 30 days | Will be created",
      "Folamour | Facebook + Instagram · 365 days | Reused",
      "Robbie Doherty | Facebook + Instagram · 365 days | Reused",
      "Ewan McVicar | Facebook + Instagram · 365 days | Will be created",
      "House music · Disco · Defected Records | 3 interests | Reused",
    ]);
  });

  it("the footer counts every interest, and says the creates wait with writes off", () => {
    assert.equal(view.reused, 9);
    assert.equal(view.toCreate, 2);
    assert.equal(view.metaCreates, 3);
    assert.equal(view.footer, "9 reused · 2 will be created in NX Promoter. Creating audiences is switched off, so these 2 wait.");
    assert.equal(buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, writesEnabled: true }, RC_E_PENDING).footer, "9 reused · 2 will be created in NX Promoter");
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
      assert.equal(v.footer, "0 reused · 0 will be created in NX Promoter");
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
    // Video viewers are the only item left to make, and they're out of both counts (Matas, 25 Nov).
    assert.equal(v.toCreate, 0);
    assert.equal(v.createCount, 0);
    assert.equal(v.footer, "10 reused · 0 will be created in NX Promoter");
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
    assert.equal(v.toCreate, 6);
    assert.equal(v.createCount, 6);
    assert.equal(v.addCount, 3);
    assert.equal(v.leftOut, 9);
    assert.equal(v.footer, "3 reused · 6 will be created in Electric Studios Sheffield. Creating audiences is switched off, so these 6 wait.");
  });
});


  describe("the footer and Create count the same audiences (one function)", () => {
    const sheffield = { ...ctx, accountId: SU_C_HELD_DATA.accountId, accountName: SU_C_HELD_DATA.accountName, pixelId: SU_C_HELD_DATA.pixelId, pixelName: SU_C_HELD_DATA.pixelName };
    const cases: Array<[string, ReturnType<typeof buildTemplateView>]> = [
      ["RC-E", buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, ctx, RC_E_PENDING)],
      ["SU-C", buildTemplateView(SU_C_TEMPLATE, SU_C_DATA.known, ctx)],
      ["SU-C-held", buildTemplateView(SU_C_HELD_TEMPLATE, SU_C_HELD_DATA.known, sheffield)],
      ["writes on", buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, { ...ctx, writesEnabled: true }, RC_E_PENDING)],
    ];
    for (const [name, v] of cases) {
      it(`${name}: toCreate === createCount`, () => assert.equal(v.toCreate, v.createCount));
    }

    it("video viewers are in none of them, though their row still reads Will be created", () => {
      // Every template above holds a video-viewers pool that no account has.
      for (const [, v] of cases) {
        const row = v.groups[1]!.rows.find((r) => r.title === "Video viewers")!;
        assert.equal(row.status, "create");
        assert.equal(row.statusLabel, "Will be created");
      }
      const videoOnly = { ...HOUSE_DISCO, items: HOUSE_DISCO.items.filter((i) => i.listRole === "video_viewers") };
      const v = buildTemplateView(videoOnly, [], ctx);
      assert.equal(v.toCreate, 0);
      assert.equal(v.createCount, 0);
      assert.equal(v.footer, "0 reused · 0 will be created in NX Promoter");
    });

    it("RC-E's footer reads as before: Ewan McVicar's two, no video viewers", () => {
      assert.equal(cases[0]![1].footer, "9 reused · 2 will be created in NX Promoter. Creating audiences is switched off, so these 2 wait.");
    });
  });
});

