import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isInPaydayWindow } from "../../dashboard/pacing.ts";
import { boardCounts, makeMissing, type BoardCell } from "../board.ts";
import { backfillReleases, deriveSaleDates } from "../dates.ts";
import { applyCount, applyState, freshness, releaseHeadline } from "../entry.ts";
import { defaultLadder, puzzleLadder } from "../ladder.ts";
import type { Release, TicketWarning } from "../types.ts";
import { approveWarning, backToHeld, claimWindow, notNow, paydayPush, todaySentence } from "../windows.ts";
import { nextRung, proposalOnChange } from "../../ticket-warnings/next-rung.ts";

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
    assert.equal(general?.triggerValue, "roll_call");
    assert.equal(general?.claim, "Early bird · 2nd release SOLD OUT\nGeneral sale live · selling fast");

    const third = nextRung(puzzle[3]!, ladder, puzzle, NOW);
    assert.equal(third?.claim, "3rd release live · selling fast");
    assert.equal(third?.met, true);

    const early = nextRung(puzzle[0]!, ladder, puzzle, NOW);
    assert.equal(early?.claim, "sold out");

    const second = release({
      name: "2nd release",
      position: 2,
      state: "selling_fast",
      stateAt: "2026-10-29",
    });
    const fast = nextRung(second, ladder, [second], "2026-11-04T09:00:00Z");
    assert.equal(fast?.met, true);
    assert.equal(fast?.claim, "2nd release 90% sold out");
    assert.match(fast?.because ?? "", /5\+ days/);

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

  it("the default ladder waits 7 days and can say final X instead", () => {
    const row = release({ name: "3rd release", position: 1, state: "selling_fast", stateAt: "2026-11-01" });
    const six = nextRung(row, defaultLadder(), [row], "2026-11-07T00:00:00Z");
    assert.equal(six?.claim, "3rd release live · selling fast");
    const seven = nextRung(row, defaultLadder(), [row], "2026-11-08T00:00:00Z");
    assert.equal(seven?.claim, "3rd release 90% sold out");
    const alt = defaultLadder().map((rung) =>
      rung.triggerValue === "selling_fast" ? { ...rung, options: { ...rung.options, wording: "final_x" as const } } : rung,
    );
    const chosen = nextRung(row, alt, [row], "2026-11-08T00:00:00Z");
    assert.equal(chosen?.claim, "final X 3rd release tickets");
  });

  it("a proposal is written only when the met claim changed", () => {
    const rung = nextRung(
      release({ name: "2nd release", position: 1, state: "selling_fast", stateAt: "2026-10-29" }),
      puzzleLadder(),
      [],
      "2026-11-04T09:00:00Z",
    );
    assert.equal(proposalOnChange("2nd release live · selling fast", rung).propose, true);
    assert.equal(proposalOnChange("2nd release 90% sold out", rung).propose, false);
    assert.equal(proposalOnChange(null, { ...rung!, met: false }).propose, false);
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
});
