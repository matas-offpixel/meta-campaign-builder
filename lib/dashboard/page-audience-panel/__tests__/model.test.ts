/**
 * HE2's panel rules (PA1–PA7, PB3, PB4, PH7, HP1, HP2, JR1–JR5) on Electric's real
 * counts (./fixture.ts), internal and share.
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
  JOIN_RATE_LABEL,
  JOIN_RATE_SUB,
  JOINED_OVER_REACHABLE,
  joinRateSource,
  offeredLine,
  REACHABLE_SUB,
  scopeLine,
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

const PAGE_NAMES = new Map(ELECTRIC_PAGES.map((p) => [p.pageId, p.name]));

function block(pages: PageAudienceFigures[], opts: { period?: PanelPeriod; surface?: PanelSurface; history?: Map<string, PageDayCounts[]>; entered?: Parameters<typeof buildSignupsBlock>[0]["entered"] } = {}): SignupsBlock {
  return buildSignupsBlock({
    kind: "shows",
    heading: null,
    label: "Test",
    pages,
    entered: opts.entered ?? null,
    pageNames: PAGE_NAMES,
    history: opts.history ?? new Map(),
    period: opts.period ?? "launch",
    surface: opts.surface ?? "internal",
    nowMs: NOW,
  });
}

const step = (b: SignupsBlock, id: string) => b.steps.find((s) => s.id === id);

describe("HE2 panel · the steps (PA2, PA3, HP1, JR1)", () => {
  it("Glitterbox: 1 Email signups → 2 Reachable on WhatsApp → 3 community → the join rate last", () => {
    const b = block([figures("EBR27-GLITTERBOX")]);
    assert.deepEqual(
      b.steps.map((s) => [s.label, s.value, s.sub]),
      [
        ["1 · Email signups", "1,410", null],
        ["2 · Reachable on WhatsApp", "310", REACHABLE_SUB],
        ["3 · Community members", "410", "joined from signups"],
        ["Opt-in → community", "39.0 %", "of reachable signups joined"],
      ],
    );
    assert.equal(step(b, "rate")!.source, "CIRQLIN · 121 of 310 · since launch");
    assert.equal(step(b, "signups")!.source, SOURCE_LINE);
    assert.equal(step(b, "community")!.source, "CIRQLIN · exact");
    assert.equal(b.source, "CIRQLIN · counted signups, spam removed");
  });

  it("a page that doesn't offer WhatsApp reads the not-offered line, not 0, and no footnote", () => {
    const b = block([figures("NX26-LOCKLEAD", { channels_offered: ["email", "sms"], whatsapp_with_phone: 0 })]);
    const s = step(b, "reachable")!;
    assert.equal(s.value, null);
    assert.equal(s.sub, WHATSAPP_NOT_OFFERED);
    assert.equal(b.stepsNote, null);
  });

  it("an entered member count leads; CIRQLIN's joins go under it; the rate stays CIRQLIN's", () => {
    const entered = { members: 1200, countedOn: "2026-11-14", entered: { at: "2026-11-14T10:00:00Z", name: "Sam" } };
    const internal = block([figures("NX26-LOCKLEAD")], { entered });
    const c = step(internal, "community")!;
    assert.equal(c.value, "1,200");
    assert.equal(c.sub, "members");
    assert.equal(c.source, "entered by Sam, 14 Nov");
    assert.equal(c.lines[0], "257 joined from signups · CIRQLIN");
    assert.deepEqual(internal.steps.map((s) => s.id), ["signups", "reachable", "community", "rate"]);
    assert.equal(step(internal, "rate")!.value, "46.7 %");
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

describe("HE2 panel · the join rate only since launch (JR2); windows (PA3)", () => {
  const f = figures("NX26-LOCKLEAD");
  const history = new Map<string, PageDayCounts[]>([
    [f.pageId, [{ fetchDay: "2026-11-09", signups: 600, consentMarketing: 70, whatsappWithPhone: 70, communityJoined: 240, communityLinkClicks: 880, partnerOptIn: 0 }]],
  ]);

  it("7 days: no rate tile, left out not dashed; the community tile reads '{j} joined in the last 7 days'", () => {
    const b = block([f], { period: "7", history });
    assert.deepEqual(b.steps.map((s) => s.id), ["signups", "reachable", "community"]);
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

  it("every dated period leaves the tile out, internal and share", () => {
    const all: PageDayCounts[] = [{ fetchDay: "2026-10-01", signups: 0, consentMarketing: 0, whatsappWithPhone: 0, communityJoined: 0, communityLinkClicks: 0, partnerOptIn: 0 }];
    for (const surface of ["internal", "share"] as const) {
      for (const period of ["30", "14", "7", "3", "yesterday"] as const) {
        const b = block([f], { history: new Map([[f.pageId, all]]), surface, period });
        assert.deepEqual(b.steps.map((s) => s.id), ["signups", "reachable", "community"], `${surface} ${period}`);
        assert.doesNotMatch(JSON.stringify(b), /Opt-in → community|Derived/);
      }
      const launch = block([f], { history, surface });
      assert.deepEqual(launch.steps.map((s) => s.id), ["signups", "reachable", "community", "rate"]);
      assert.doesNotMatch(JSON.stringify(launch), /Derived/);
    }
  });
});

describe("HE2 panel · the join rate (JR1–JR3)", () => {
  const rate = (b: SignupsBlock) => step(b, "rate");

  it("one decimal, the tile's line and its counts (Locklead: 35 of 75)", () => {
    const r = rate(block([figures("NX26-LOCKLEAD")]))!;
    assert.equal(r.label, JOIN_RATE_LABEL);
    assert.equal(r.value, "46.7 %");
    assert.equal(r.sub, JOIN_RATE_SUB);
    assert.equal(r.source, "CIRQLIN · 35 of 75 · since launch");
    assert.deepEqual(r.lines, []);
  });

  it("several pages sum both counts, then divide; never an average of the pages' rates", () => {
    // Glitterbox 121 / 310 (39.0 %), Locklead 35 / 75 (46.7 %): 156 / 385 = 40.5 %, not 42.9 %.
    const r = rate(block([figures("EBR27-GLITTERBOX"), figures("NX26-LOCKLEAD")]))!;
    assert.equal(r.value, "40.5 %");
    assert.equal(r.source, "CIRQLIN · 156 of 385 · since launch");
  });

  it("a page that doesn't offer WhatsApp adds nothing to either count", () => {
    const noWa = figures("NX26-DOD", { channels_offered: ["email", "sms"], community_joined_reachable: 40 });
    const r = rate(block([figures("NX26-LOCKLEAD"), noWa]))!;
    assert.equal(r.source, "CIRQLIN · 35 of 75 · since launch");
  });

  it("nothing reachable in scope: the tile is left out", () => {
    assert.equal(rate(block([figures("NX26-LOCKLEAD", { channels_offered: ["email"], whatsapp_with_phone: 0 })])), undefined);
    assert.equal(rate(block([figures("NX26-LOCKLEAD", { whatsapp_with_phone: 0, community_joined_reachable: 0 })])), undefined);
  });

  it("a page read before #647 is left out of both counts and named in the suffix", () => {
    const before = (code: string) => figures(code, { community_joined_reachable: null });
    const one = rate(block([figures("NX26-LOCKLEAD"), before("EBR27-GLITTERBOX")]))!;
    assert.equal(one.value, "46.7 %");
    assert.equal(one.source, "CIRQLIN · 35 of 75 · since launch · 1 page without this count yet");
    const two = rate(block([figures("NX26-LOCKLEAD"), before("EBR27-GLITTERBOX"), before("NX26-DOD")]))!;
    assert.equal(two.source, "CIRQLIN · 35 of 75 · since launch · 2 pages without this count yet");
    // Every page before #647: nothing counted is reachable, so no tile.
    assert.equal(rate(block([before("NX26-LOCKLEAD")])), undefined);
    // A row that never selected the column reads the same as null.
    const p = electricPage("NX26-LOCKLEAD");
    const row = storedRow(p);
    delete row.community_joined_reachable;
    assert.equal(rate(block([toFigures(p.eventId, false, row)])), undefined);
  });

  it("joinRateSource words: '1 page' / '{m} pages'", () => {
    assert.equal(joinRateSource(122, 314), "CIRQLIN · 122 of 314 · since launch");
    assert.equal(joinRateSource(1234, 5678, 1), "CIRQLIN · 1,234 of 5,678 · since launch · 1 page without this count yet");
  });

  for (const surface of ["internal", "share"] as const) {
    it(`${surface}: a read over 100 % shows 100.0 %; only internal names the page`, () => {
      const over = figures("NX26-LOCKLEAD", { community_joined_reachable: 80 });
      const r = rate(block([over], { surface }))!;
      assert.equal(r.value, "100.0 %");
      assert.equal(r.source, "CIRQLIN · 80 of 75 · since launch");
      assert.deepEqual(
        r.lines,
        surface === "internal" ? ["Joined-and-reachable is more than reachable on Locklead's page. Check CIRQLIN's read."] : [],
      );
      // Summed with Glitterbox: 201 / 385 = 52.2 %, under the cap, and the review line still names Locklead.
      const sum = rate(block([over, figures("EBR27-GLITTERBOX")], { surface }))!;
      assert.equal(sum.value, "52.2 %");
      assert.equal(sum.lines.length, surface === "internal" ? 1 : 0);
    });
  }

  it("the HP1 footnote stays beside the tile (JR4)", () => {
    const b = block([figures("EBR27-GLITTERBOX")]);
    assert.ok(rate(b));
    assert.equal(b.stepsNote, JOINED_OVER_REACHABLE);
  });
});

describe("HE2 panel · step 3 over step 2 (HP1)", () => {
  for (const surface of ["internal", "share"] as const) {
    it(`${surface}: the footnote shows when joined is more than reachable`, () => {
      // Glitterbox: 410 joined, 310 reachable. Locklead: 257 and 75.
      assert.equal(block([figures("EBR27-GLITTERBOX")], { surface }).stepsNote, JOINED_OVER_REACHABLE);
      assert.equal(block([figures("NX26-LOCKLEAD")], { surface }).stepsNote, "Joining the community doesn't need a marketing opt-in, so this can be more than step 2.");
    });
    it(`${surface}: no footnote when step 3 isn't more than step 2`, () => {
      // D.O.D: 0 joined, 324 reachable. Equal counts don't get it either.
      assert.equal(block([figures("NX26-DOD")], { surface }).stepsNote, null);
      assert.equal(block([figures("NX26-LOCKLEAD", { community_joined: 75 })], { surface }).stepsNote, null);
    });
  }
  it("an entered count is step 3's figure when it leads", () => {
    const entered = { members: 50, countedOn: "2026-11-14", entered: { at: "2026-11-14T10:00:00Z", name: null } };
    // Locklead: 50 members (< 75 reachable), though 257 joined.
    assert.equal(block([figures("NX26-LOCKLEAD")], { entered }).stepsNote, null);
  });
  it("a window compares the window's counts", () => {
    const f = figures("NX26-LOCKLEAD");
    const history = new Map<string, PageDayCounts[]>([
      [f.pageId, [{ fetchDay: "2026-11-09", signups: 600, consentMarketing: 70, whatsappWithPhone: 70, communityJoined: 240, communityLinkClicks: 880, partnerOptIn: 0 }]],
    ]);
    // 17 joined, 5 reachable in the last 7 days.
    assert.equal(block([f], { period: "7", history }).stepsNote, JOINED_OVER_REACHABLE);
  });
});

describe("HE2 panel · the scope line (HP2)", () => {
  it("no repeated source; '1 CIRQLIN page' for one", () => {
    const line = scopeLine("Locklead", 1, "2026-11-16", NOW);
    assert.equal(line, "Locklead · 1 CIRQLIN page · read 16 Nov");
    assert.doesNotMatch(line, /spam removed/);
  });
  it("names shows without a page, '1 show' for one", () => {
    assert.equal(scopeLine("X", 2, "2026-11-16", NOW, 1), "X · 2 CIRQLIN pages · read 16 Nov · 1 show without a CIRQLIN page");
    assert.equal(scopeLine("X", 2, "2026-11-16", NOW, 4), "X · 2 CIRQLIN pages · read 16 Nov · 4 shows without a CIRQLIN page");
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
      // Five Electric shows have no page; the umbrella isn't counted as one.
      assert.equal(shows!.scopeLine, "Electric Brixton · 15 CIRQLIN pages · read 16 Nov · 5 shows without a CIRQLIN page");
      assert.equal(umbrella!.scopeLine, "Global Marketing · 1 CIRQLIN page · read 16 Nov");
      assert.equal(umbrella!.kind, "umbrella");
      assert.equal(umbrella!.heading, "Global Marketing · its own page, never added to the shows");
      assert.equal(step(umbrella!, "signups")!.value, "825");
      // Partner: the five pages with a box (429 + 166 + 88 + 116 + 1).
      assert.equal(shows!.partner!.line, "Partner opt-in · 800");
      // JR3: the shows' rate sums both counts across pages; the umbrella gets its own from its own page.
      const reachable = showPages.reduce((s, p) => s + p.whatsapp, 0);
      assert.equal(reachable, 2298);
      assert.equal(step(shows!, "rate")!.value, "13.7 %");
      assert.equal(step(shows!, "rate")!.source, "CIRQLIN · 314 of 2,298 · since launch");
      assert.equal(step(umbrella!, "rate")!.value, "0.0 %");
      assert.equal(step(umbrella!, "rate")!.source, "CIRQLIN · 0 of 825 · since launch");
    });
  }

  it("a venue view holds only its shows; a show chip is that page", () => {
    const panels = buildSignupsPanels(electricInput(), electricViews(), "internal", NOW);
    const bristol = panels["venue:electric bristol"]!.launch;
    assert.equal(bristol.blocks.length, 1);
    assert.equal(step(bristol.blocks[0]!, "signups")!.value, "2,003");
    assert.equal(bristol.blocks[0]!.scopeLine, "Electric Bristol · 2 CIRQLIN pages · read 16 Nov");
    // Glitterbox 121 / 310 and Kream 0 / 134.
    assert.equal(step(bristol.blocks[0]!, "rate")!.source, "CIRQLIN · 121 of 444 · since launch");
    assert.equal(step(bristol.blocks[0]!, "rate")!.value, "27.3 %");
    assert.match(panels["venue:nx newcastle"]!.launch.blocks[0]!.scopeLine, / · 4 shows without a CIRQLIN page$/);
    assert.match(panels["venue:electric studios"]!.launch.blocks[0]!.scopeLine, / · 1 show without a CIRQLIN page$/);
    // A show with no page has no panel.
    assert.equal(panels["nx26-eed"], undefined);
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
