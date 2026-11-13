import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { PROPOSED_COUNT_ALIASES, matchShow } from "../aliases.ts";
import { bodyMentionsSales, isInternalCountsMessage, subjectCountDate } from "../message.ts";
import { extractPdfTextItems } from "../pdf-text.ts";
import { parseInternalCountsItems, type ParsedSheet } from "../parse.ts";
import { planReport, type EventRef, type PlanContext } from "../plan.ts";

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const events = new Map<string, EventRef>(
  Object.values(PROPOSED_COUNT_ALIASES).map((code) => [
    code,
    { id: `id-${code}`, eventCode: code, userId: "u1", clientId: "c1" },
  ]),
);

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    eventsByCode: events,
    confirmedAliases: PROPOSED_COUNT_ALIASES,
    previousTotal: () => null,
    storedTotalOn: () => null,
    ...over,
  };
}

const report = { subject: "Internal Show counts 12.11.26", body: "Hi, Please see today's internal show counts attached." };

describe("isInternalCountsMessage (proposed rule)", () => {
  const yes = [
    "Internal Counts 27.10.26",
    "Internal Show counts 11.11.26",
    "Internal Show ticket counts 10.11.26",
    "Internal Show Counts 04.11.26",
    "INTERNAL SHOW COUNTS - 22.09.26",
  ];
  const no = [
    "Re: Internal Counts 23.10.26",
    "Fw: Internal Counts 05.10.26",
    "FW: Internal Counts 30.09.26",
    "Re: Internal Show counts 06.11.26",
    "Internals",
    "Weekly report",
  ];
  for (const subject of yes) it(`matches "${subject}"`, () => assert.ok(isInternalCountsMessage({ subject, from: "" })));
  for (const subject of no) it(`skips "${subject}"`, () => assert.ok(!isInternalCountsMessage({ subject, from: "" })));
});

describe("subject and body", () => {
  it("reads dd.mm.yy from the subject", () => {
    assert.equal(subjectCountDate("Internal Show counts 12.11.26"), "2026-11-12");
    assert.equal(subjectCountDate("INTERNAL SHOW COUNTS - 22.09.26"), "2026-09-22");
    assert.equal(subjectCountDate("Internal Counts"), null);
  });

  it("flags a body that talks about sales, but not the quoted history", () => {
    assert.ok(
      bodyMentionsSales(
        "On Enzo, we have sold an additional 57 tickets at £39.50 … Grand total sold for this event is 1974",
      ),
    );
    assert.ok(!bodyMentionsSales("Hi All, Please see latest internal show ticket counts attached."));
    assert.ok(!bodyMentionsSales("Here are today's counts.\n\nOn 9 Oct 2026, at 12:58, M wrote:\n> total sold 12"));
  });
});

describe("matchShow", () => {
  it("never auto-matches a proposal", () => {
    assert.deepEqual(matchShow("IPC"), { eventCode: null, proposedEventCode: "NX26-IPC" });
    assert.deepEqual(matchShow("Ipc"), { eventCode: null, proposedEventCode: null });
    assert.deepEqual(matchShow("IPC", { IPC: "NX26-IPC" }), { eventCode: "NX26-IPC", proposedEventCode: "NX26-IPC" });
  });
});

describe("planReport on the 12 Nov sheet", () => {
  let sheet: ParsedSheet;
  before(async () => {
    sheet = parseInternalCountsItems(await extractPdfTextItems(new Uint8Array(read("internal-counts-2026-11-12.pdf"))));
  });

  it("with no confirmed aliases, sends every show to review with its proposal", () => {
    const plan = planReport(report, sheet, ctx({ confirmedAliases: {} }));
    assert.equal(plan.blocks.filter((b) => b.write).length, 0);
    const unmatched = plan.reviewItems.filter((i) => i.kind === "unmatched_show");
    assert.equal(unmatched.length, 9);
    assert.equal(unmatched[0].message, 'No count alias for "IPC". Proposed: NX26-IPC.');
  });

  it("with the proposals confirmed, writes all nine; IPC has one review item and no revenue", () => {
    const plan = planReport(report, sheet, ctx());
    assert.equal(plan.blocks.filter((b) => b.write).length, 9);
    assert.deepEqual(
      plan.reviewItems.map((i) => [i.kind, i.showName]),
      [["price_looks_wrong", "IPC"]],
    );
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.paidRevenuePence, null);
    assert.ok(ipc.cells.every((c) => c.revenuePence === null));
    const eed = plan.blocks.find((b) => b.showName === "EAST END DUBS")!;
    assert.equal(eed.paidRevenuePence, 5_123_000);
  });

  it("cross-checks SINCE LAST COUNT against our own delta", () => {
    const plan = planReport(report, sheet, ctx({ previousTotal: () => 1800 }));
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.ourDelta, 28);
    assert.ok(ipc.write, "a mismatch is a review item, not a block");
    assert.ok(plan.reviewItems.some((i) => i.kind === "since_last_mismatch" && i.showName === "IPC"));
  });

  it("flags a count date that disagrees with the subject", () => {
    const plan = planReport({ ...report, subject: "Internal Show counts 11.11.26" }, sheet, ctx());
    assert.equal(plan.reviewItems.filter((i) => i.kind === "count_date_mismatch").length, 9);
    assert.ok(plan.blocks.every((b) => b.write));
  });

  it("won't write a second, different count for the same show and date", () => {
    const plan = planReport(report, sheet, ctx({ storedTotalOn: (id) => (id === "id-NX26-IPC" ? 1800 : null) }));
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.write, false);
    assert.equal(ipc.repeat, false);
    assert.ok(plan.reviewItems.some((i) => i.kind === "duplicate_count_date" && i.showName === "IPC"));
    assert.equal(plan.blocks.filter((b) => b.write).length, 8);
  });

  it("passes over a block that restates a stored count, with no review item", () => {
    const plan = planReport(
      { ...report, subject: "Internal Show counts 13.11.26" },
      sheet,
      ctx({ storedTotalOn: (id) => (id === "id-NX26-IPC" ? 1828 : null) }),
    );
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.repeat, true);
    assert.equal(ipc.write, false);
    assert.equal(plan.reviewItems.filter((i) => i.showName === "IPC").length, 0);
  });

  it("never writes to the umbrella", () => {
    const plan = planReport(report, sheet, ctx({ confirmedAliases: { ...PROPOSED_COUNT_ALIASES, KREAM: "NX26-GLOBAL" } }));
    assert.equal(plan.blocks.find((b) => b.showName === "KREAM")!.write, false);
    assert.ok(plan.reviewItems.some((i) => i.kind === "umbrella"));
  });

  it("keeps blank cells null in the cell plan", () => {
    const plan = planReport(report, sheet, ctx());
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    const cell = ipc.cells.find((c) => c.outlet === "UNIVERSE" && c.tierPosition === 1)!;
    assert.equal(cell.tickets, null);
  });
});
