import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isInPaydayWindow } from "../../dashboard/pacing.ts";
import { boardCounts, makeMissing, type BoardCell } from "../board.ts";
import { backfillReleases, deriveSaleDates } from "../dates.ts";
import { applyCount, applyState, freshness, releaseHeadline } from "../entry.ts";
import { defaultLadder, puzzleLadder, resetLadder } from "../ladder.ts";
import { presentLadder } from "../present.ts";
import type { Release, TicketWarning } from "../types.ts";
import { approveWarning, backToHeld, claimWindow, notNow, paydayPush, todaySentence } from "../windows.ts";
import { countdownRung, lineupRung, percentStandIn, priceRiseRung, velocityRung } from "../derived.ts";
import { OFFER_MARKER, OFFER_ON_LADDER, OFFER_REFUSAL, enteredByLine, enteredByWhen, offerPrices, offerRefusal, offerWords, operatorDisplayName } from "../offers.ts";
import { liveClaimLine, rollCallWords, soldOutLine } from "../roll-call.ts";
import { isBackfilled, mountsReleases, panelFigure, todayListsEvent, warningCell } from "../visibility.ts";
import { derivedProposals, nextRung, proposalOnChange } from "../../ticket-warnings/next-rung.ts";

const NOW = "2026-11-07T12:00:00Z";

function release(partial: Pick<Release, "name" | "position" | "state"> & Partial<Release>): Release {
  return {
    id: partial.name,
    eventId: "puzzle",
    communityAt: null,
    listAt: null,
    stateAt: null,
    stateSource: null,
    stateSetBy: null,
    price: null,
    capacity: null,
    sold: null,
    remaining: null,
    ...partial,
  };
}

const puzzle = [
  release({ name: "Early bird", position: 1, state: "sold_out", stateAt: "2026-10-28", listAt: "2026-10-21", communityAt: "2026-10-21" }),
  release({
    name: "2nd release",
    position: 2,
    state: "sold_out",
    stateAt: "2026-11-05",
    communityAt: "2026-10-29T11:30:00+00:00",
    listAt: "2026-10-29T12:00:00+00:00",
  }),
  release({ name: "General sale", position: 3, state: "on_sale", stateAt: "2026-10-30", listAt: "2026-10-30T12:00:00+00:00" }),
  release({
    name: "3rd release",
    position: 4,
    state: "selling_fast",
    stateAt: "2026-11-06",
    communityAt: "2026-11-06T11:30:00+00:00",
    listAt: "2026-11-06T12:00:00+00:00",
  }),
];

function warning(partial: Partial<TicketWarning> & Pick<TicketWarning, "claim" | "state">): TicketWarning {
  return {
    id: "w",
    eventId: "puzzle",
    releaseId: "3rd release",
    format: "9:16",
    trigger: null,
    approvedAt: null,
    runsFrom: null,
    runsTo: null,
    why: null,
    ...partial,
  };
}

describe("derived sale dates and the backfill", () => {
  it("derives presale from the first community time and general sale from that release's list time", () => {
    const dates = deriveSaleDates(puzzle);
    assert.equal(dates.presaleAt, "2026-10-21");
    assert.equal(dates.generalSaleAt, "2026-10-30T12:00:00+00:00");
  });

  it("backfills two releases and round-trips the two columns", () => {
    const rows = backfillReleases({ presaleAt: "2026-10-21T10:00:00Z", generalSaleAt: "2026-12-01T12:00:00Z" }, NOW);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.state, "on_sale");
    assert.equal(rows[1]!.state, "not_yet");
    const again = deriveSaleDates(rows.map((row) => ({ ...row, name: row.name })));
    assert.equal(again.presaleAt, "2026-10-21T10:00:00Z");
    assert.equal(again.generalSaleAt, "2026-12-01T12:00:00Z");
  });

  it("a list time that has not passed stays not yet", () => {
    const rows = backfillReleases({ presaleAt: null, generalSaleAt: "2026-12-01T00:00:00Z" }, NOW);
    assert.equal(rows[0]!.state, "not_yet");
    assert.equal(rows[1]!.state, "not_yet");
  });
});

describe("state entry, counts, freshness", () => {
  it("a backwards tap asks once, then writes", () => {
    const third = puzzle[3]!;
    const asked = applyState(third, "on_sale", { at: NOW, source: "entry", user: "matas", confirmed: false });
    assert.equal(asked.ask, true);
    assert.equal(asked.release.state, "selling_fast");
    const written = applyState(third, "on_sale", { at: NOW, source: "client_message", user: "matas", confirmed: true });
    assert.equal(written.ask, false);
    assert.equal(written.release.state, "on_sale");
    assert.equal(written.release.stateAt, NOW);
    assert.equal(written.release.stateSource, "client_message");
    assert.equal(written.release.stateSetBy, "matas");
  });

  it("a count writes tier_channel_sales only when the capacity is known", () => {
    const open = applyCount(puzzle[2]!, 400);
    assert.equal(open.release.sold, 400);
    assert.equal(open.tierSale, null);
    const known = applyCount({ ...puzzle[2]!, capacity: 1000 }, 400);
    assert.deepEqual(known.tierSale, { tierName: "General sale", channel: "manual", ticketsSold: 400 });
  });

  it("update after 3 days, lock after 7, and only while on sale or selling fast", () => {
    const stale = freshness(puzzle[2]!, NOW);
    assert.equal(stale.days, 8);
    assert.equal(stale.update, true);
    assert.equal(stale.lock, true);
    assert.equal(stale.line, "locked · state is 8 days old");
    const third = freshness(puzzle[3]!, NOW);
    assert.equal(third.days, 1);
    assert.equal(third.update, false);
    const three = freshness({ ...puzzle[2]!, stateAt: "2026-11-04" }, NOW);
    assert.equal(three.days, 3);
    assert.equal(three.update, true);
    assert.equal(three.lock, false);
    const done = freshness(puzzle[0]!, NOW);
    assert.equal(done.update, false);
    assert.equal(done.lock, false);
  });

  it("the big number counts on sale and selling fast, and a sold total only when every release has a count", () => {
    const open = releaseHeadline(puzzle);
    assert.deepEqual(open, { onSale: 2, total: 4, soldOut: 2, sold: null });
    const counted = releaseHeadline(puzzle.map((row, i) => ({ ...row, sold: (i + 1) * 10 })));
    assert.equal(counted.sold, 100);
  });
});

describe("next rung", () => {
  const ladder = puzzleLadder();

  it("each trigger kind on the fixture releases, including the roll-call", () => {
    const general = nextRung(puzzle[2]!, ladder, puzzle, NOW);
    assert.equal(general?.met, true);
    assert.equal(general?.triggerValue, "selling_fast");
    assert.equal(general?.claim, "General sale selling fast");

    const third = nextRung(puzzle[3]!, ladder, puzzle, NOW);
    assert.equal(third?.claim, "3rd release selling fast");
    assert.equal(third?.met, true);

    const early = nextRung(puzzle[0]!, ladder, puzzle, NOW);
    assert.equal(early?.claim, "sold out");

    const second = release({
      name: "2nd release",
      position: 2,
      state: "selling_fast",
      stateAt: "2026-10-29",
    });
    const fast = nextRung(second, ladder, [second], "2026-11-13T09:00:00Z");
    assert.equal(fast?.met, true);
    assert.equal(fast?.claim, "2nd release 90% sold out");
    assert.match(fast?.because ?? "", /14\+ days/);

    const counted = nextRung({ ...puzzle[2]!, sold: 50, capacity: 100 }, ladder, [puzzle[2]!], NOW);
    assert.equal(counted?.claim, "75% sold");
    assert.equal(counted?.triggerKind, "count_pct");

    const ninety = nextRung({ ...puzzle[3]!, sold: 90, capacity: 100, state: "selling_fast" }, ladder, puzzle, NOW);
    assert.equal(ninety?.claim, "99% sold");

    const finalWords = nextRung(
      { ...puzzle[3]!, state: "final_x", remaining: 40 },
      ladder,
      puzzle,
      NOW,
    );
    assert.equal(finalWords?.claim, "final 40");

    const pageLadder = [
      ...ladder,
      { position: 11, triggerKind: "page_remaining" as const, triggerValue: "40", claimTemplate: "under 40 remain", options: {} },
    ];
    const page = nextRung({ ...puzzle[3]!, state: "on_sale", remaining: 40, sold: null }, pageLadder, [puzzle[3]!], NOW);
    assert.equal(page?.triggerKind, "page_remaining");
    assert.equal(page?.met, true);
  });

  it("selling fast for 15 days proposes 90% sold out; 13 days does not", () => {
    const seeded = defaultLadder().find((rung) => rung.triggerKind === "state_days" && rung.triggerValue === "selling_fast");
    const reset = resetLadder().find((rung) => rung.triggerKind === "state_days" && rung.triggerValue === "selling_fast");
    assert.equal(seeded?.options.days, 14);
    assert.equal(reset?.options.days, 14);
    const row = release({ name: "3rd release", position: 1, state: "selling_fast", stateAt: "2026-11-01" });
    const thirteen = nextRung(row, defaultLadder(), [row], "2026-11-14T00:00:00Z");
    assert.equal(thirteen?.claim, "3rd release selling fast");
    assert.notEqual(thirteen?.claim, "3rd release 90% sold out");
    const fifteen = nextRung(row, defaultLadder(), [row], "2026-11-16T00:00:00Z");
    assert.equal(fifteen?.claim, "3rd release 90% sold out");
    const alt = defaultLadder().map((rung) =>
      rung.triggerValue === "selling_fast" ? { ...rung, options: { ...rung.options, wording: "final_x" as const } } : rung,
    );
    const chosen = nextRung(row, alt, [row], "2026-11-16T00:00:00Z");
    assert.equal(chosen?.claim, "final X 3rd release tickets");
  });

  it("a proposal is written only when the met claim changed", () => {
    const rung = nextRung(
      release({ name: "2nd release", position: 1, state: "selling_fast", stateAt: "2026-10-29" }),
      puzzleLadder(),
      [],
      "2026-11-13T09:00:00Z",
    );
    assert.equal(proposalOnChange("2nd release selling fast", rung).propose, true);
    assert.equal(proposalOnChange("2nd release 90% sold out", rung).propose, false);
    assert.equal(proposalOnChange(null, { ...rung!, met: false }).propose, false);
  });
});

describe("roll-call words", () => {
  it("joins two names, three names, and a release named Final release", () => {
    assert.equal(soldOutLine(["Early bird", "2nd release"]), "EARLY BIRD & 2ND RELEASE SOLD OUT");
    assert.equal(soldOutLine(["Early bird", "2nd release", "3rd release"]), "EARLY BIRD, 2ND & 3RD RELEASE SOLD OUT");
    assert.equal(soldOutLine(["Early bird", "Final release"]), "EARLY BIRD & FINAL RELEASE SOLD OUT");
  });

  it("ranks the roll-call above a % rung for the same release", () => {
    const sold = (name: string, position: number) =>
      release({ name, position, state: "sold_out", stateAt: "2026-11-01", stateSource: "client_message", stateSetBy: "matas" });
    const final = release({
      name: "Final release",
      position: 4,
      state: "selling_fast",
      stateAt: "2026-11-06",
      stateSource: "client_message",
      stateSetBy: "matas",
      sold: 95,
      capacity: 100,
    });
    const siblings = [sold("Early bird", 1), sold("2nd release", 2), sold("3rd release", 3), final];
    const rung = nextRung(final, puzzleLadder(), siblings, NOW);
    assert.equal(rung?.triggerKind, "roll_call");
    assert.equal(rung?.met, true);
    assert.equal(rung?.claim, "EARLY BIRD, 2ND & 3RD RELEASE SOLD OUT\n99% SOLD");
    assert.equal(liveClaimLine({ ...final, state: "final_x", remaining: 100 }), "FINAL 100 FINAL RELEASE TICKETS");
    const percent = nextRung({ ...final, state: "selling_fast" }, puzzleLadder().filter((row) => row.triggerKind !== "roll_call"), siblings, NOW);
    assert.equal(percent?.triggerKind, "count_pct");
    const seeded = defaultLadder().find((row) => row.triggerValue === "roll_call");
    assert.equal(seeded?.triggerKind, "roll_call");
    assert.equal(seeded?.options.preferred, true);
  });

  it("counts a final X release as the live one, so the second line can name the tickets left", () => {
    const sold = (name: string, position: number) =>
      release({ name, position, state: "sold_out", stateAt: "2026-11-01", stateSource: "client_message", stateSetBy: "matas" });
    const final = release({
      name: "Final release",
      position: 4,
      state: "final_x",
      stateAt: "2026-11-06",
      stateSource: "client_message",
      stateSetBy: "matas",
      remaining: 100,
    });
    const siblings = [sold("Early bird", 1), sold("2nd release", 2), sold("3rd release", 3), final];
    const words = rollCallWords(siblings);
    assert.equal(words.met, true);
    assert.equal(words.line2, "FINAL 100 FINAL RELEASE TICKETS");
    const rung = nextRung(final, puzzleLadder(), siblings, NOW);
    assert.equal(rung?.triggerKind, "roll_call");
    assert.equal(rung?.claim, "EARLY BIRD, 2ND & 3RD RELEASE SOLD OUT\nFINAL 100 FINAL RELEASE TICKETS");
    const bothLive = [
      ...siblings,
      release({ name: "General sale", position: 5, state: "on_sale", stateSource: "entry", stateSetBy: "matas" }),
    ];
    assert.equal(rollCallWords(bothLive).met, false);
  });

  it("only the latest release whose list time has passed proposes rung 1", () => {
    const presale = release({
      name: "Presale",
      position: 1,
      state: "on_sale",
      listAt: "2026-10-21T12:00:00Z",
      stateSource: "entry",
      stateSetBy: "matas",
    });
    const general = release({
      name: "General sale",
      position: 2,
      state: "on_sale",
      listAt: "2026-10-30T12:00:00Z",
      stateSource: "entry",
      stateSetBy: "matas",
    });
    const siblings = [presale, general];
    const now = "2026-11-10T12:00:00Z";
    const live = nextRung(general, defaultLadder(), siblings, now);
    assert.equal(live?.claim, "General sale live");
    assert.equal(live?.met, true);
    assert.equal(proposalOnChange("anything else", live).propose, true);
    const ended = nextRung(presale, defaultLadder(), siblings, now);
    assert.equal(ended?.met, false);
    assert.equal(proposalOnChange("Presale live", ended).propose, false);
  });

  it("a first release on sale does not meet selling fast with no earlier release", () => {
    const only = release({
      name: "General sale",
      position: 1,
      state: "on_sale",
      listAt: "2026-10-30T12:00:00Z",
      stateSource: "entry",
      stateSetBy: "matas",
    });
    const rung = nextRung(only, defaultLadder(), [only], NOW);
    assert.equal(rung?.claim, "General sale live");
    assert.equal(rung?.triggerValue, "on_sale");
  });

  it("the roll-call's second line is selling fast when the live release is only on sale", () => {
    const sold = (name: string, position: number) =>
      release({ name, position, state: "sold_out", stateAt: "2026-10-01", stateSource: "client_message", stateSetBy: "matas" });
    const live = release({
      name: "3rd release",
      position: 4,
      state: "on_sale",
      listAt: "2026-11-06T12:00:00Z",
      stateSource: "entry",
      stateSetBy: "matas",
    });
    const siblings = [sold("Early bird", 1), sold("1st", 2), sold("2nd release", 3), live];
    const rung = nextRung(live, defaultLadder(), siblings, NOW);
    assert.equal(rung?.claim, "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT\n3RD RELEASE SELLING FAST");
    const words = rollCallWords(siblings, { ladder: defaultLadder(), nowIso: NOW });
    assert.equal(words.line1, "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT");
    assert.equal(words.line2, "3RD RELEASE SELLING FAST");
    assert.equal(words.claim.includes("RUNNING LOW"), false);
  });

  it("line 2 names final X, or 90% sold out after the selling-fast days, and never running low", () => {
    const sold = (name: string, position: number) =>
      release({ name, position, state: "sold_out", stateAt: "2026-10-01", stateSource: "client_message", stateSetBy: "matas" });
    const final = release({
      name: "Final release",
      position: 4,
      state: "final_x",
      stateAt: "2026-11-06",
      stateSource: "client_message",
      stateSetBy: "matas",
      remaining: 100,
    });
    const finalWords = rollCallWords(
      [sold("Early bird", 1), sold("2nd release", 2), sold("3rd release", 3), final],
      { ladder: defaultLadder(), nowIso: NOW },
    );
    assert.equal(finalWords.line2, "FINAL 100 FINAL RELEASE TICKETS");
    const fast = release({
      name: "Final release",
      position: 4,
      state: "selling_fast",
      stateAt: "2026-10-23",
      stateSource: "client_message",
      stateSetBy: "matas",
    });
    const fastWords = rollCallWords(
      [sold("Early bird", 1), sold("2nd release", 2), sold("3rd release", 3), fast],
      { ladder: defaultLadder(), nowIso: NOW },
    );
    assert.equal(fastWords.line2, "FINAL RELEASE 90% SOLD OUT");
    assert.equal(`${finalWords.claim}\n${fastWords.claim}`.includes("RUNNING LOW"), false);
  });
});

describe("derived rungs", () => {
  it("locks a velocity rung with one count", () => {
    const one = velocityRung([{ at: "2026-11-07", sold: 1000 }], NOW);
    assert.equal(one.locked, true);
    assert.equal(one.met, false);
    assert.equal(one.because, "needs a second count");
    const two = velocityRung(
      [
        { at: "2026-10-24", sold: 400 },
        { at: "2026-11-07", sold: 1000 },
      ],
      NOW,
    );
    assert.equal(two.locked, false);
    assert.equal(two.met, true);
    assert.equal(two.claim, "600+ TICKETS SOLD IN THE LAST 2 WEEKS");
    const thousands = velocityRung(
      [
        { at: "2026-10-24", sold: 400 },
        { at: "2026-11-07", sold: 1499 },
      ],
      NOW,
    );
    assert.equal(thousands.claim, "1,000+ TICKETS SOLD IN THE LAST 2 WEEKS");
  });

  it("says prices rise on the weekday, or tomorrow, and drops the price when the release has none", () => {
    const withPrice = priceRiseRung(NOW, "2026-11-10T12:00:00Z", 16.5, 4);
    assert.equal(withPrice.met, true);
    assert.equal(withPrice.claim, "PRICES RISE TUESDAY\nLAST CHANCE AT £16.50");
    const noPrice = priceRiseRung(NOW, "2026-11-10T12:00:00Z", null, 4);
    assert.equal(noPrice.claim, "PRICES RISE TUESDAY");
    assert.equal(priceRiseRung(NOW, "2026-11-08T12:00:00Z", null, 4).claim, "PRICES RISE TOMORROW");
    assert.equal(priceRiseRung(NOW, "2026-11-20T12:00:00Z", 10, 4).met, false);
  });

  it("needs the % rung as well as two weeks to the show", () => {
    const met = countdownRung(NOW, "2026-11-18", true, 14);
    assert.equal(met.met, true);
    assert.equal(met.claim, "LESS THAN 2 WEEKS TO GO\nOVER 90% SOLD OUT");
    assert.equal(countdownRung(NOW, "2026-11-18", false, 14).met, false);
    assert.equal(countdownRung(NOW, "2026-11-18", false, 14, true).met, true);
    assert.equal(countdownRung(NOW, "2026-12-27", true, 14).met, false);
    const fast = release({
      name: "3rd release",
      position: 3,
      state: "selling_fast",
      stateAt: "2026-10-24",
      stateSource: "client_message",
      stateSetBy: "matas",
    });
    assert.equal(percentStandIn(fast, NOW, 5), true);
    const proposals = derivedProposals(puzzleLadder(), [fast], NOW, { eventAt: "2026-11-18T00:00:00Z", sellingFastDays: 5 });
    assert.equal(proposals.some((proposal) => proposal.triggerKind === "countdown_pct"), true);
    const mark = nextRung(fast, puzzleLadder(), [fast], NOW, { eventAt: "2026-11-18T00:00:00Z", sellingFastDays: 5 });
    assert.equal(mark?.triggerKind, "state_days");
  });

  it("refreshes the lineup slot instead of filing a new cell", () => {
    const added = lineupRung(
      [{ name: "Reeshy", addedAt: "2026-11-01" }, { name: "Enzo Siragusa", addedAt: "2026-11-08" }],
      "2026-11-02",
    );
    assert.equal(added.met, true);
    assert.equal(added.claim, "ENZO SIRAGUSA (JUST ANNOUNCED)");
    assert.equal(added.newCell, false);
    assert.equal(lineupRung([{ name: "Reeshy", addedAt: "2026-11-01" }], "2026-11-02").met, false);
    const newestNotLast = lineupRung(
      [{ name: "Enzo Siragusa", addedAt: "2026-11-08" }, { name: "Reeshy", addedAt: "2026-11-03" }],
      "2026-11-02",
    );
    assert.equal(newestNotLast.artist, "ENZO SIRAGUSA");
  });

  it("does not announce the original lineup, and does announce an artist saved later", () => {
    const first = "2026-11-06T20:32:28Z";
    const puzzle = ["Enzo Siragusa", "Luke Dean", "Reeshy", "Phill de Janeiro", "Benji King"].map((name) => ({
      name,
      addedAt: first,
      source: "lab" as const,
    }));
    assert.equal(lineupRung(puzzle, null).met, false);
    const later = lineupRung(
      [...puzzle, { name: "Interplanetary Criminal", addedAt: "2026-11-07T20:32:28Z", source: "lab" }],
      null,
    );
    assert.equal(later.met, true);
    assert.equal(later.claim, "INTERPLANETARY CRIMINAL (JUST ANNOUNCED)");
    assert.equal(lineupRung(puzzle, null).met, false);
    const copied = lineupRung(
      [...puzzle, { name: "A later name", addedAt: "2026-11-08T20:32:28Z", source: "ad_copy" }],
      null,
    );
    assert.equal(copied.met, false);
  });

  it("leaves a release's mark on its state rung when a derived rung is also met", () => {
    const row = release({
      name: "General sale",
      position: 1,
      state: "on_sale",
      stateAt: NOW,
      stateSource: "entry",
      stateSetBy: "matas",
      price: 16.5,
    });
    const context = {
      counts: [{ at: "2026-10-01", sold: 0 }, { at: "2026-11-07", sold: 1000 }],
      eventAt: "2026-12-27T00:00:00Z",
      nextListAt: "2026-11-10T12:00:00Z",
      artists: [{ name: "Enzo", addedAt: "2026-11-08" }],
      sellingFastDays: 5,
    };
    const mark = nextRung(row, defaultLadder(), [row], NOW, context);
    assert.equal(mark?.triggerValue, "on_sale");
    const proposals = derivedProposals(defaultLadder(), [row], NOW, context);
    assert.equal(proposals.some((proposal) => proposal.triggerKind === "velocity" && proposal.claim.startsWith("1,000+")), true);
    assert.equal(proposals.some((proposal) => proposal.triggerKind === "velocity" && mark?.claim === proposal.claim), false);
  });
});

describe("offers, cancelled, backfilled", () => {
  it("refuses sold, final, last and a percent sign, and lets finale through", () => {
    assert.equal(OFFER_REFUSAL, "An offer can't say sold, final, last or %.");
    assert.equal(offerRefusal("final release £10"), OFFER_REFUSAL);
    assert.equal(offerRefusal("SOLD OUT"), OFFER_REFUSAL);
    assert.equal(offerRefusal("last chance"), OFFER_REFUSAL);
    assert.equal(offerRefusal("90%"), OFFER_REFUSAL);
    assert.equal(offerRefusal("finale night"), null);
    assert.equal(offerRefusal("£10 today, split the rest in 3"), null);
    assert.equal(OFFER_ON_LADDER, false);
    const words = offerWords("payment_plan", { today: 10, parts: 3 });
    assert.deepEqual(words.lines, ["£10 TODAY", "SPLIT THE REST IN 3"]);
    assert.equal(words.card, "£10 today · split the rest in 3");
    assert.equal(OFFER_MARKER, "entered, not derived");
    assert.deepEqual(offerPrices({ today: 10, parts: 3 }), [10]);
  });

  it("names the operator on the offer card and never the user id", () => {
    const at = new Date("2026-11-08T14:10:00Z");
    const id = "11111111-1111-1111-1111-111111111111";
    assert.equal(enteredByLine("Matas", at), "entered by Matas, 8 Nov");
    assert.equal(enteredByWhen(at).wide, "Sun 8 Nov 14:10");
    assert.equal(enteredByLine(id, at), null);
    assert.equal(operatorDisplayName({ id, user_metadata: { full_name: "Matas" } }), "Matas");
    assert.equal(operatorDisplayName({ id, user_metadata: { name: id } }), null);
  });

  it("keeps a cancelled event's rows and mounts no panel and no Today row", () => {
    const rows = [release({ name: "General sale", position: 1, state: "on_sale" })];
    assert.equal(mountsReleases("cancelled"), false);
    assert.equal(todayListsEvent("cancelled", rows), false);
    assert.equal(warningCell("cancelled", "90% sold out"), "cancelled · nothing to make");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, "General sale");
  });

  it("a backfilled row proposes nothing until the first tap", () => {
    const row = release({
      name: "Presale",
      position: 1,
      state: "not_yet",
      stateSource: "entry",
      stateSetBy: null,
    });
    assert.equal(isBackfilled(row), true);
    assert.equal(nextRung(row, puzzleLadder(), [row], NOW), null);
    assert.equal(proposalOnChange(null, null).propose, false);
    assert.equal(panelFigure([row, { ...row, name: "General sale", state: "on_sale" }]).headline, "—");
    const tapped = applyState(row, "not_yet", { at: NOW, source: "entry", user: "matas", confirmed: true });
    assert.equal(isBackfilled(tapped.release), false);
    assert.equal(tapped.release.stateSetBy, "matas");
    assert.equal(tapped.release.stateSource, "entry");
    assert.equal(todayListsEvent("on_sale", [row]), false);
    assert.equal(todayListsEvent("on_sale", [tapped.release]), true);
  });
});

describe("approval, windows, the board", () => {
  it("approve schedules, not now takes the next window, and a moved trigger goes back to held", () => {
    const held = warning({ claim: "3rd release 90% sold out", state: "held" });
    const scheduled = approveWarning(held, "2026-11-05T12:00:00Z");
    assert.equal(scheduled.state, "scheduled");
    assert.equal(scheduled.approvedAt, "2026-11-05T12:00:00Z");

    const later = notNow(held, "2026-11-27");
    assert.equal(later.state, "held");
    assert.ok(later.runsFrom && later.runsFrom > "2026-11-27");
    assert.equal(isInPaydayWindow(later.runsFrom!), true);

    const outside = notNow(held, "2026-12-16");
    assert.equal(isInPaydayWindow("2026-12-16"), false);
    assert.equal(isInPaydayWindow(outside.runsFrom!), true);

    const returned = backToHeld(scheduled, "Today's read shows it on sale, not selling fast.");
    assert.equal(returned.state, "back_to_held");
    assert.equal(todaySentence(returned), "Today's read shows it on sale, not selling fast.");
    assert.equal(backToHeld(held, "no").state, "held");
    assert.match(todaySentence(held) ?? "", /Proposed/);
  });

  it("a live claim runs at the release time, and the payday push moves off Christmas and a bank holiday", () => {
    const live = claimWindow("3rd release live · selling fast", "2026-11-06T12:00:00Z", "2026-12-20");
    assert.equal(live.atRelease, true);
    assert.equal(live.from, "2026-11-06");
    assert.equal(isInPaydayWindow("2026-12-20"), false);

    const inside = claimWindow("90% sold out", null, "2026-11-27");
    assert.equal(inside.inside, true);
    assert.equal(inside.atRelease, false);
    assert.equal(isInPaydayWindow(inside.from), true);

    const christmas = paydayPush(2026, 12);
    assert.equal(christmas.friday, "2026-12-25");
    assert.equal(christmas.day, "2026-12-24");
    assert.equal(christmas.reason, "moved · 25th is Christmas");

    const friday = paydayPush(2026, 11).friday;
    const bank = paydayPush(2026, 11, new Map([[friday, "bank holiday"]]));
    assert.equal(bank.day < friday, true);
    assert.equal(bank.reason, "moved · bank holiday");
  });

  it("the shaded window is the code's 18 days", () => {
    assert.equal(isInPaydayWindow("2026-11-25"), false);
    assert.equal(isInPaydayWindow("2026-11-26"), true);
    let days = 0;
    let cursor = "2026-11-26";
    while (isInPaydayWindow(cursor)) {
      days += 1;
      const next = new Date(`${cursor}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      cursor = next.toISOString().slice(0, 10);
    }
    assert.equal(days, 18);
    assert.equal(cursor, "2026-12-14");
  });

  it("board counts, and making nothing when every missing cell needs a piece", () => {
    const cells: BoardCell[] = [
      ...Array.from({ length: 15 }, () => ({ status: "approved" as const })),
      { status: "proposed" },
      ...Array.from({ length: 3 }, () => ({ status: "locked" as const })),
      ...Array.from({ length: 5 }, () => ({ status: "missing" as const, makeable: false })),
    ];
    assert.deepEqual(boardCounts(cells), { approved: 15, proposed: 1, locked: 3, missing: 5, makeable: 0 });
    assert.deepEqual(makeMissing(cells), { made: 0, said: "Nothing to make. The missing cells need a piece." });
    const ready = [{ status: "missing" as const, makeable: true }, { status: "missing" as const, makeable: false }];
    assert.equal(makeMissing(ready).made, 1);
  });

  it("AB5 draws Puzzle's ladder with the record's sub-lines and a quoted claim on every rung", () => {
    const rows = presentLadder(puzzleLadder(), "Puzzle");
    assert.equal(rows.length, 15);
    const ninety = rows.find((row) => row.trigger.startsWith("Selling fast for"));
    assert.equal(ninety?.trigger, "Selling fast for 14+ days, no count");
    assert.equal(ninety?.detail, "the default");
    assert.equal(rows[0]!.claim, "\"{release} live\"");
    assert.equal(rows[0]!.detail, "only the latest release that has gone live");
    assert.equal(rows[1]!.claim, "\"{release} selling fast\"");
    assert.equal(rows[1]!.detail, "day 0 · 2+ earlier sold out → the roll-call is preferred");
    assert.equal(rows[1]!.mark, "new");
    assert.equal(rows[3]!.detail, "when a count and a capacity exist");
    assert.equal(ninety?.note, "\"final X {release} tickets\" is the other option");
    assert.equal(
      rows.find((row) => row.trigger.startsWith("2+ releases"))!.note,
      "two lines · the names from the releases, in order · line 2 is the live release's highest met rung — never lower than selling fast",
    );
    assert.equal(rows.find((row) => row.trigger.startsWith("2+ releases"))!.detail, "roll-call · preferred over the % rung and over rung 2");
    assert.equal(rows.find((row) => row.trigger.startsWith("Sold now"))!.detail, "sales velocity · needs two counts · window and count per client");
    assert.equal(rows.find((row) => row.trigger === "State final X")!.note, "X from the page or the count, never typed");
    assert.equal(rows.find((row) => row.trigger.startsWith("Next release"))!.note, "qualifier \"LAST CHANCE AT £{n}\" when the release has a price");
    assert.equal(rows.at(-1)!.note, "refreshes the lineup slot and every ALONGSIDE: list");
    assert.ok(rows.every((row) => row.claim.includes("\"")));
    const seeded = presentLadder(defaultLadder());
    assert.equal(seeded[2]!.trigger, "Selling fast for 14+ days, no count");
    assert.equal(seeded[2]!.detail, "the default");
    const custom = defaultLadder().map((rung) =>
      rung.triggerKind === "state_days" && rung.triggerValue === "selling_fast"
        ? { ...rung, options: { ...rung.options, days: 5 } }
        : rung,
    );
    const shown = presentLadder(custom, "Puzzle").find((row) => row.trigger.startsWith("Selling fast for"));
    assert.equal(shown?.trigger, "Selling fast for 5+ days, no count");
    assert.equal(shown?.detail, "Puzzle: 5 days (default 14)");
  });

  it("a client whose 90% window is not 14 days names that count under the main line", () => {
    const custom = defaultLadder().map((rung) =>
      rung.triggerKind === "state_days" && rung.triggerValue === "selling_fast"
        ? { ...rung, options: { ...rung.options, days: 7 } }
        : rung,
    );
    const shown = presentLadder(custom, "Innervisions").find((row) => row.trigger.startsWith("Selling fast for"));
    assert.equal(shown?.trigger, "Selling fast for 7+ days, no count");
    assert.equal(shown?.detail, "Innervisions: 7 days (default 14)");
  });
});
