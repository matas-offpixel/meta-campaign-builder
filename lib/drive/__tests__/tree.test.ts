import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVENT_TREE,
  addDays,
  cycleDue,
  cycleFolderName,
  eventFolderName,
  fortnightlyFrom,
  freeRenderFileName,
  paydayCycleMondays,
  renderFileName,
  routeRender,
  winnerFileName,
} from "../tree.ts";

const P26 = { name: "Puzzle 4th Birthday", event_date: "2026-12-27", event_code: "P26-BDAY" };
const fortnightly = fortnightlyFrom("2026-11-02");
const ENZO = { kind: "artist" as const, artistId: "lab-enzo", name: "Enzo Siragusa" };

describe("tree paths (S13, S18)", () => {
  it("names the event folder with the date and the code verbatim", () => {
    assert.equal(eventFolderName(P26), "2026-12-27 Puzzle 4th Birthday [P26-BDAY]");
    assert.equal(eventFolderName({ ...P26, event_code: "p26-bday " }), "2026-12-27 Puzzle 4th Birthday [p26-bday]");
    assert.equal(eventFolderName({ ...P26, event_code: null }), "2026-12-27 Puzzle 4th Birthday");
    assert.equal(eventFolderName({ ...P26, status: "cancelled" }), "2026-12-27 Puzzle 4th Birthday [P26-BDAY] (cancelled)");
  });

  it("has every S18 folder, parent before child, no w/c folders up front", () => {
    const names = EVENT_TREE.map((spec) => spec.name);
    for (const name of ["00 Brief & admin", "01 Open files", "02 Source", "Artist clips", "Press kits", "Venue & crowd", "03 Creatives", "1 Signup", "Teaser", "Announcement", "2 Presale", "Presale live", "Reminders", "3 On sale", "4 Show week", "04 D2C", "05 Reports", "06 Post-event", "_Winners"]) {
      assert.ok(names.includes(name), name);
    }
    const seen = new Set(["event"]);
    for (const spec of EVENT_TREE) {
      assert.ok(seen.has(spec.parent!), `${spec.key} after its parent`);
      seen.add(spec.key);
    }
    assert.ok(!EVENT_TREE.some((spec) => spec.key.includes("/wc/")));
    // D4: Teaser has no voice children; owner folders come with the first filing.
    for (const gone of ["Artist", "Promoter", "Experience", "UGC", "Ticket warnings", "Content"]) assert.ok(!names.includes(gone), gone);
  });

  it("names a cycle w/c {d Mon}", () => {
    assert.equal(cycleFolderName("2026-11-16"), "w/c 16 Nov");
    assert.equal(cycleFolderName("2026-12-07"), "w/c 7 Dec");
  });
});

// Ruling (Matas, 9 Nov 2026): production keeps the payday-led cycles from the
// code's calendar — the Monday of payday week (last Friday of the month) and
// the Monday a fortnight later (paydayCycleMondays): 26 Oct, 9 Nov, 23 Nov,
// 7 Dec, 21 Dec 2026. HS13's worked example (2, 16, 30 Nov, 14 Dec) assumes a
// strict fortnight from 2 Nov; it runs here with that calendar injected, as a
// test of the cadence rules only. The record itself is not changed.
describe("w/c cadence (HS13)", () => {
  it("on sale from 2 Nov, paydays fortnightly from 2 Nov: 2, 16, 30 Nov, 14 Dec, then show week from 21 Dec", () => {
    const due: string[] = [];
    for (let day = "2026-10-26"; day <= "2026-12-27"; day = addDays(day, 1)) {
      const monday = cycleDue({ today: day, onSale: day >= "2026-11-02", onSaleFrom: "2026-11-02", eventDate: "2026-12-27", calendar: fortnightly });
      if (monday && !due.includes(monday)) due.push(monday);
      if (day >= "2026-12-21") assert.equal(monday, null, day);
    }
    assert.deepEqual(due, ["2026-11-02", "2026-11-16", "2026-11-30", "2026-12-14"]);
    assert.equal(routeRender({ stage: "on-sale", today: "2026-12-21", eventDate: "2026-12-27", calendar: fortnightly, owner: ENZO, kind: "video" }).stageKey, "03/4");
  });

  it("creates nothing before on sale", () => {
    assert.equal(cycleDue({ today: "2026-11-10", onSale: false, onSaleFrom: null, eventDate: "2026-12-27", calendar: fortnightly }), null);
    assert.equal(cycleDue({ today: "2026-11-01", onSale: true, onSaleFrom: "2026-11-02", eventDate: "2026-12-27", calendar: fortnightly }), null);
  });

  it("going on sale mid-cycle gives the current cycle at once", () => {
    assert.equal(cycleDue({ today: "2026-11-20", onSale: true, onSaleFrom: "2026-11-20", eventDate: "2026-12-27", calendar: fortnightly }), "2026-11-16");
  });

  it("the code's payday calendar: payday-week Monday and a fortnight later", () => {
    assert.deepEqual(paydayCycleMondays("2026-10-01", "2027-01-31"), ["2026-10-05", "2026-10-26", "2026-11-09", "2026-11-23", "2026-12-07", "2026-12-21", "2027-01-04", "2027-01-25"]);
  });
});

describe("routing (S20) and the file name (S14)", () => {
  it("Enzo #1 × caption 2, on sale, round 1, ready 17 Nov: w/c 16 Nov / Enzo Siragusa / Videos, S14 name unchanged", () => {
    const route = routeRender({ stage: "on-sale", today: "2026-11-17", eventDate: "2026-12-27", calendar: fortnightly, owner: ENZO, kind: "video" });
    assert.equal(route.key, "03/3/wc/2026-11-16/owner/artist:lab-enzo/videos");
    assert.deepEqual([route.owner.name, route.type.name], ["Enzo Siragusa", "Videos"]);
    const name = renderFileName({ eventCode: "P26-BDAY", artistName: "Enzo Siragusa", clipNo: 1, angle: "lineup", captionNo: 2, stage: "on-sale", roundNo: 1, aspect: "9:16" });
    assert.equal(name, "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4");
  });

  it("never overwrites: a second file of that name is _v2", () => {
    const base = { eventCode: "P26-BDAY", artistName: "Enzo Siragusa", clipNo: 1, angle: "lineup", captionNo: 2, stage: "on-sale" as const, roundNo: 1, aspect: "9:16" };
    assert.equal(freeRenderFileName(base, new Set()), "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4");
    assert.equal(freeRenderFileName(base, new Set(["P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4"])), "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_v2_9x16.mp4");
    assert.equal(freeRenderFileName(base, new Set(["P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16_winner.mp4"])), "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_v2_9x16.mp4");
  });

  it("accents dropped, hyphens for spaces; winner before the extension", () => {
    assert.equal(renderFileName({ eventCode: null, artistName: "Rëeshy Dé", clipNo: 3, angle: "social-proof", captionNo: 1, stage: "signup", roundNo: 2, aspect: "9:16" }), "reeshy-de-3_social-proof1-signup_r2_9x16.mp4");
    assert.equal(winnerFileName("P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4"), "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16_winner.mp4");
    assert.equal(winnerFileName("x_winner.mp4"), "x_winner.mp4");
  });
});
