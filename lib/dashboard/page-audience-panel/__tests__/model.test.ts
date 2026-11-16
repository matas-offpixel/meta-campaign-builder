/**
 * HE2's panel rules (PA1–PA7, PB3, PB4, PH7) on Electric's real counts
 * (./fixture.ts), internal and share.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toFigures, type PageAudienceFigures } from "../../../cirqlin/page-audience/read.ts";
import { PANEL_FRAME_NOW_MS } from "../dates.ts";
import { ELECTRIC_PAGES, electricInput, electricPage, electricViews, storedRow } from "../fixture.ts";
import {
  buildGeography,
  buildSignupsBlock,
  buildSignupsPanels,
  COULDNT_TELL,
  EVERYWHERE_ELSE,
  GEOGRAPHY_WITHHELD,
  inviteClicksLine,
  offeredLine,
  REACHABLE_SUB,
  SOURCE_LINE,
  WHATSAPP_NOT_OFFERED,
  type PageDayCounts,
  type PanelPeriod,
  type PanelSurface,
  type SignupsBlock,
} from "../model.ts";

const NOW = PANEL_FRAME_NOW_MS;

function figures(code: string, patch: Partial<ReturnType<typeof storedRow>> = {}): PageAudienceFigures {
  const p = electricPage(code);
  return toFigures(p.eventId, p.umbrella === true, { ...storedRow(p), ...patch });
}

function block(pages: PageAudienceFigures[], opts: { period?: PanelPeriod; surface?: PanelSurface; history?: Map<string, PageDayCounts[]>; entered?: Parameters<typeof buildSignupsBlock>[0]["entered"] } = {}): SignupsBlock {
  return buildSignupsBlock({
    kind: "shows",
    heading: null,
    label: "Test",
    pages,
    entered: opts.entered ?? null,
    history: opts.history ?? new Map(),
    period: opts.period ?? "launch",
    surface: opts.surface ?? "internal",
    nowMs: NOW,
  });
}

const step = (b: SignupsBlock, id: string) => b.steps.find((s) => s.id === id);

describe("HE2 panel · the three steps (PA2, PA3)", () => {
  it("Glitterbox: 1 Email signups → 2 Reachable on WhatsApp → 3 community, with the join rate", () => {
    const b = block([figures("EBR27-GLITTERBOX")]);
    assert.deepEqual(
      b.steps.map((s) => [s.label, s.value, s.sub]),
      [
        ["1 · Email signups", "1,410", null],
        ["2 · Reachable on WhatsApp", "310", REACHABLE_SUB],
        ["3 · Community members", "410", "joined from signups"],
        ["Opt-in → community", "132.3 %", null],
      ],
    );
    assert.equal(step(b, "signups")!.source, SOURCE_LINE);
    assert.equal(step(b, "community")!.source, "CIRQLIN · exact");
    assert.equal(b.source, "CIRQLIN · counted signups, spam removed");
  });

  it("a page that doesn't offer WhatsApp reads the not-offered line, not 0, and has no join rate", () => {
    const b = block([figures("NX26-LOCKLEAD", { channels_offered: ["email", "sms"], whatsapp_with_phone: 0 })]);
    const s = step(b, "reachable")!;
    assert.equal(s.value, null);
    assert.equal(s.sub, WHATSAPP_NOT_OFFERED);
    assert.equal(step(b, "join"), undefined);
  });

  it("an entered member count leads; CIRQLIN's joins go under it; the join rate stays joined ÷ reachable", () => {
    const entered = { members: 1200, countedOn: "2026-11-14", entered: { at: "2026-11-14T10:00:00Z", name: "Sam" } };
    const internal = block([figures("NX26-LOCKLEAD")], { entered });
    const c = step(internal, "community")!;
    assert.equal(c.value, "1,200");
    assert.equal(c.sub, "members");
    assert.equal(c.source, "entered by Sam, 14 Nov");
    assert.equal(c.lines[0], "257 joined from signups · CIRQLIN");
    // 257 ÷ 75, never 1,200 ÷ 75.
    assert.equal(step(internal, "join")!.value, "342.7 %");
    const share = block([figures("NX26-LOCKLEAD")], { entered, surface: "share" });
    assert.equal(step(share, "community")!.source, "entered 14 Nov");
  });

  it("without an entered count the headline is '{j} joined from signups' (PB4), 0 included", () => {
    const c = step(block([figures("NX26-DOD")]), "community")!;
    assert.equal(c.value, "0");
    assert.equal(c.sub, "joined from signups");
  });

  it("PH7: an entered date from an earlier year carries it", () => {
    const entered = { members: 10, countedOn: "2025-12-01", entered: { at: "2025-12-01T10:00:00Z", name: null } };
    assert.equal(step(block([figures("NX26-LOCKLEAD")], { entered }), "community")!.source, "entered 1 Dec 2025");
  });
});

describe("HE2 panel · join rate on Since launch only (PA3)", () => {
  const f = figures("NX26-LOCKLEAD");
  const history = new Map<string, PageDayCounts[]>([
    [f.pageId, [{ fetchDay: "2026-11-09", signups: 600, consentMarketing: 70, whatsappWithPhone: 70, communityJoined: 240, communityLinkClicks: 880, partnerOptIn: 0 }]],
  ]);

  it("7 days: no join rate; the community tile reads '{j} joined in the last 7 days'", () => {
    const b = block([f], { period: "7", history });
    assert.equal(step(b, "join"), undefined);
    const c = step(b, "community")!;
    assert.equal(c.value, "17");
    assert.equal(c.sub, "joined in the last 7 days");
    assert.equal(step(b, "signups")!.value, "49");
    assert.equal(step(b, "reachable")!.value, "5");
    assert.equal(b.marketing!.line, "Marketing opt-in · 5 · 10.2 % of signups");
  });

  it("a period no stored read reaches says so instead of a figure", () => {
    const b = block([f], { period: "30" });
    assert.equal(b.steps.length, 0);
    assert.equal(b.notCounted, "No CIRQLIN read before 18 Oct yet, so this period isn't counted.");
  });

  it("Since launch has the join rate", () => {
    assert.ok(step(block([f], { history }), "join"));
  });
});

describe("HE2 panel · marketing opt-in (PA1)", () => {
  it("one figure with its share of signups, the offered channels beside it, in order", () => {
    const b = block([figures("EBR27-GLITTERBOX")]);
    assert.equal(b.marketing!.line, "Marketing opt-in · 310 · 22.0 % of signups");
    assert.equal(b.marketing!.offered, "offered: email · SMS · WhatsApp");
    assert.equal(offeredLine(["whatsapp", "email"]), "offered: email · WhatsApp");
  });
});

describe("HE2 panel · partner opt-in (PA5, PB3)", () => {
  it("no box: the row is left out", () => {
    assert.equal(block([figures("NX26-DOD")]).partner, null);
  });
  it("a box: the count, 0 included", () => {
    assert.equal(block([figures("EBR27-GLITTERBOX")]).partner!.line, "Partner opt-in · 429");
    const zero = block([figures("EBR27-GLITTERBOX", { partner_opt_in: 0 })]);
    assert.equal(zero.partner!.line, "Partner opt-in · 0");
    assert.equal(zero.partner!.sub, "agreed to hear from the page's partner promoters");
  });
  it("a row from before cirqlin #633: shown only above 0", () => {
    assert.equal(block([figures("NX26-DOD", { partner_box_offered: null })]).partner, null);
    assert.equal(block([figures("NX26-DOD", { partner_box_offered: null, partner_opt_in: 3 })]).partner!.line, "Partner opt-in · 3");
  });
});

describe("HE2 panel · invite link clicks (PA4)", () => {
  it("not shared: '{n} invite link clicks · every source', internal and share", () => {
    for (const surface of ["internal", "share"] as const) {
      assert.deepEqual(step(block([figures("NX26-LOCKLEAD")], { surface }), "community")!.lines, ["906 invite link clicks · every source"]);
    }
  });
  it("shared: internal names it as shared; the share link hides it", () => {
    assert.deepEqual(step(block([figures("ES26-FEVER105")]), "community")!.lines, ["0 clicks on an invite shared with other pages"]);
    assert.deepEqual(step(block([figures("ES26-FEVER105")], { surface: "share" }), "community")!.lines, []);
    assert.equal(inviteClicksLine(12, true, "share"), null);
  });
  it("never in a total: a block of several pages has no clicks line", () => {
    const b = block([figures("NX26-LOCKLEAD"), figures("EBR27-GLITTERBOX")]);
    assert.deepEqual(step(b, "community")!.lines, []);
    assert.doesNotMatch(JSON.stringify(b), /invite/);
  });
});

describe("HE2 panel · views and the umbrella", () => {
  for (const surface of ["internal", "share"] as const) {
    it(`${surface}: the client view sums the shows and keeps Global Marketing its own block`, () => {
      const panels = buildSignupsPanels(electricInput(), electricViews(), surface, NOW);
      const all = panels.all!.launch;
      assert.equal(all.title, "Signups & communities");
      assert.equal(all.blocks.length, 2);
      const [shows, umbrella] = all.blocks;
      const showPages = ELECTRIC_PAGES.filter((p) => !p.umbrella);
      assert.equal(step(shows!, "signups")!.value, showPages.reduce((s, p) => s + p.signups, 0).toLocaleString("en-GB"));
      assert.equal(step(shows!, "signups")!.value, "13,223");
      assert.equal(shows!.scopeLine, "Electric Brixton · 15 CIRQLIN pages · read 16 Nov");
      assert.equal(umbrella!.kind, "umbrella");
      assert.equal(umbrella!.heading, "Global Marketing · its own page, never added to the shows");
      assert.equal(step(umbrella!, "signups")!.value, "825");
      // Partner: the five pages with a box (429 + 166 + 88 + 116 + 1).
      assert.equal(shows!.partner!.line, "Partner opt-in · 800");
    });
  }

  it("a venue view holds only its shows; a show chip is that page", () => {
    const panels = buildSignupsPanels(electricInput(), electricViews(), "internal", NOW);
    const bristol = panels["venue:electric bristol"]!.launch;
    assert.equal(bristol.blocks.length, 1);
    assert.equal(step(bristol.blocks[0]!, "signups")!.value, "2,003");
    const gl = panels["nx26-global"]!.launch;
    assert.equal(gl.blocks.length, 1);
    assert.equal(gl.blocks[0]!.kind, "umbrella");
  });
});

describe("HE2 geography in Who we reached (PA6, E1)", () => {
  it("a show: five named cities, Everywhere else, Couldn't tell, adding up to its signups", () => {
    const geo = buildGeography(electricInput(), electricViews(), "share", NOW);
    const dod = geo["nx26-dod"]!.blocks[0]!;
    assert.deepEqual(
      dod.rows!.map((r) => [r.label, r.value]),
      [
        ["Newcastle upon Tyne", "215"],
        ["Gateshead", "107"],
        ["Glasgow", "90"],
        ["Sunderland", "70"],
        ["Stockton-on-Tees", "54"],
        [EVERYWHERE_ELSE, "1,151"],
        [COULDNT_TELL, "156"],
      ],
    );
    const sum = dod.rows!.reduce((s, r) => s + Number(r.value.replace(/,/g, "")), 0);
    assert.equal(sum, 1843);
    assert.equal(dod.source, "CIRQLIN · counted signups, spam removed");
  });

  it("a city under 10 is never named", () => {
    const f = figures("NX26-LOCKLEAD", {
      geo_cities: [{ name: "London", region: "ENG", country: "GB", signups: 168 }, { name: "Tiny", region: null, country: "GB", signups: 9 }],
      geo_everywhere_else: 472,
    });
    const input = { ...electricInput(), pages: new Map([[f.eventId, f]]) };
    const geo = buildGeography(input, electricViews(), "internal", NOW)["nx26-locklead"]!.blocks[0]!;
    assert.deepEqual(geo.rows!.map((r) => r.label), ["London", EVERYWHERE_ELSE, COULDNT_TELL]);
    assert.equal(geo.rows![1]!.value, "481");
  });

  it("the client view keeps the umbrella apart; Couldn't tell is never spread", () => {
    const geo = buildGeography(electricInput(), electricViews(), "internal", NOW).all!;
    assert.equal(geo.blocks.length, 2);
    const shows = geo.blocks[0]!;
    assert.equal(shows.rows!.at(-1)!.value, "848");
    assert.match(shows.footnote, /^Electric Brixton · 13,223 signups on 15 CIRQLIN pages · read 16 Nov/);
    assert.equal(geo.blocks[1]!.kind, "umbrella");
  });

  it("a read that doesn't add up is withheld; the note names the page internally only", () => {
    const f = figures("NX26-LOCKLEAD", { geo_couldnt_tell: 5 });
    const input = { ...electricInput(), pages: new Map([[f.eventId, f]]) };
    const internal = buildGeography(input, electricViews(), "internal", NOW)["nx26-locklead"]!.blocks[0]!;
    assert.equal(internal.rows, null);
    assert.equal(internal.withheld, GEOGRAPHY_WITHHELD);
    assert.equal(internal.note, "Doesn't add up: Locklead's page");
    const share = buildGeography(input, electricViews(), "share", NOW)["nx26-locklead"]!.blocks[0]!;
    assert.equal(share.withheld, GEOGRAPHY_WITHHELD);
    assert.equal(share.note, null);
  });
});
