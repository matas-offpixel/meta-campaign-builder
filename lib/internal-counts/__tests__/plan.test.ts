import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { PROPOSED_COUNT_ALIASES } from "../aliases.ts";
import { extractPdfTextItems } from "../pdf-text.ts";
import { parseInternalCountsItems, type ParsedSheet } from "../parse.ts";
import { planReport, type EventRef, type PlanContext } from "../plan.ts";

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const events = new Map<string, EventRef>(
  [...Object.values(PROPOSED_COUNT_ALIASES), "NX26-GLOBAL"].map((code) => [
    code,
    { id: `id-${code}`, eventCode: code, name: code, eventDate: null, userId: "u1", clientId: "c1", isUmbrella: code === "NX26-GLOBAL" },
  ]),
);

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    eventsByCode: events,
    confirmedAliases: PROPOSED_COUNT_ALIASES,
    notOurs: new Set(),
    closest: () => null,
    priceCeiling: () => null,
    previous: () => null,
    storedOn: () => null,
    latestStored: () => null,
    mentionSeen: () => false,
    ...over,
  };
}

const report = {
  subject: "Internal Show Count 12.11.26",
  body: "Hello, Please see today's internal show count attached.",
  pdfFilename: "MIKE'S INTERNAL SHOWS - INTERNAL COUNTS (23).pdf",
  forward: false,
  sentAt: "2026-11-12T11:33:36Z",
};

describe("planReport on the 12 Nov sheet", () => {
  let sheet: ParsedSheet;
  before(async () => {
    sheet = parseInternalCountsItems(await extractPdfTextItems(new Uint8Array(read("internal-counts-2026-11-12.pdf"))));
  });

  it("HM4: IPC's counts are stored, its revenue is held, and exactly one price item is written", () => {
    const plan = planReport(report, sheet, ctx());
    assert.equal(plan.sheetDate, "2026-11-12");
    assert.equal(plan.blocks.filter((b) => b.status === "write").length, 9);
    assert.deepEqual(
      plan.reviewItems.map((i) => [i.kind, i.showName]),
      [["price_looks_wrong", "IPC"]],
    );
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.paid, 1828);
    assert.equal(ipc.revenueHeld, true);
    assert.ok(ipc.cells.every((c) => c.revenuePence === null));
    assert.equal(ipc.priceFlags.length, 7);
  });

  it("HM4: −£1.00 tiers are skipped silently", () => {
    const plan = planReport(report, sheet, ctx());
    const eed = plan.blocks.find((b) => b.showName === "EAST END DUBS")!;
    assert.equal(eed.revenueHeld, false);
    assert.equal(eed.paidRevenuePence, 5_123_000);
    assert.ok(eed.cells.filter((c) => c.unused).every((c) => c.revenuePence === null));
    assert.equal(plan.reviewItems.filter((i) => i.showName === "EAST END DUBS").length, 0);
  });

  it("HM2: neither sample is held on date; a subject date that disagrees holds the whole sheet", () => {
    assert.equal(planReport(report, sheet, ctx()).reviewItems.filter((i) => i.kind === "date_mismatch").length, 0);
    const plan = planReport({ ...report, subject: "Internal Show Count 13.11.26" }, sheet, ctx());
    assert.deepEqual(
      plan.reviewItems.filter((i) => i.kind === "date_mismatch").map((i) => i.detail),
      [{ sheetDate: "2026-11-12", subjectDate: "2026-11-13" }],
    );
    assert.ok(plan.blocks.every((b) => b.status === "held"));
  });

  it("M2: with no date in the subject, the PDF date stands alone", () => {
    const plan = planReport({ ...report, subject: "Internal Counts" }, sheet, ctx());
    assert.ok(plan.blocks.every((b) => b.status === "write" && b.countDate === "2026-11-12"));
  });

  it("M1: an unmatched name is held, never auto-matched, with its closest event", () => {
    const plan = planReport(
      report,
      sheet,
      ctx({ confirmedAliases: {}, closest: (n) => (n === "IPC" ? { eventCode: "NX26-IPC", name: "Interplanetary Criminal", eventDate: "2026-11-21" } : null) }),
    );
    assert.ok(plan.blocks.every((b) => b.status === "held"));
    const ipc = plan.reviewItems.find((i) => i.kind === "unmatched_show" && i.showName === "IPC")!;
    assert.deepEqual(ipc.detail, { closest: { eventCode: "NX26-IPC", name: "Interplanetary Criminal", eventDate: "2026-11-21" } });
  });

  it("M3: \"Not a show we run\" never asks again", () => {
    const plan = planReport(report, sheet, ctx({ notOurs: new Set(["KREAM"]), confirmedAliases: {} }));
    assert.equal(plan.blocks.find((b) => b.showName === "KREAM")!.status, "not_ours");
    assert.equal(plan.reviewItems.filter((i) => i.showName === "KREAM").length, 0);
  });

  const storedIpc = (total: number, sentAt = "2026-11-12T09:00:00Z") =>
    ctx({ storedOn: (id) => (id === "id-NX26-IPC" ? { total, sentAt, blockId: "b-earlier" } : null) });

  it("M1 corrections: a later email with a different count for a stored date replaces it, with a note", () => {
    const plan = planReport(report, sheet, storedIpc(1826));
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.status, "write");
    assert.equal(ipc.replaces, true);
    assert.deepEqual(
      plan.reviewItems.find((i) => i.kind === "replaced")!.detail,
      { countDate: "2026-11-12", previousTotal: 1826, total: 1828, previousBlockId: "b-earlier" },
    );
  });

  it("M1b change 1: a forward with a different sheet for a stored date never replaces it", () => {
    const plan = planReport({ ...report, subject: "Fw: Internal Show Count 12.11.26", forward: true }, sheet, storedIpc(1826));
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.status, "held");
    assert.equal(ipc.replaces, false);
    const item = plan.reviewItems.find((i) => i.kind === "replaced")!;
    assert.equal(item.detail.forward, true);
  });

  it("M1b change 5: 'later' is the Date header; an earlier email arriving late doesn't replace", () => {
    const plan = planReport(report, sheet, storedIpc(1826, "2026-11-12T15:00:00Z"));
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.status, "superseded");
    assert.equal(plan.reviewItems.find((i) => i.kind === "replaced")!.detail.previousIsThis, true);
  });

  it("a restated count (same show, date and total) writes nothing and asks nothing", () => {
    const plan = planReport(report, sheet, ctx({ storedOn: (id) => (id === "id-NX26-EED" ? { total: 1731, sentAt: null, blockId: "b" } : null) }));
    assert.equal(plan.blocks.find((b) => b.showName === "EAST END DUBS")!.status, "repeat");
    assert.equal(plan.reviewItems.filter((i) => i.showName === "EAST END DUBS").length, 0);
  });

  it("cross-checks SINCE LAST COUNT against our own delta, as a note", () => {
    const plan = planReport(report, sheet, ctx({ previous: () => ({ total: 1800, countDate: "2026-11-11", messageId: "m-11" }) }));
    const ipc = plan.blocks.find((b) => b.showName === "IPC")!;
    assert.equal(ipc.ourDelta, 28);
    assert.equal(ipc.status, "write");
    assert.ok(plan.reviewItems.some((i) => i.kind === "since_last_mismatch" && i.showName === "IPC"));
  });

  it("never writes to the umbrella (events.is_umbrella)", () => {
    const plan = planReport(report, sheet, ctx({ confirmedAliases: { ...PROPOSED_COUNT_ALIASES, KREAM: "NX26-GLOBAL" } }));
    assert.equal(plan.blocks.find((b) => b.showName === "KREAM")!.status, "held");
  });

  it("an unreadable PDF stores nothing", () => {
    const plan = planReport(report, { blocks: [], problems: ["No block header (TOTAL · SINCE LAST COUNT) found in the PDF."] }, ctx());
    assert.equal(plan.unreadable, true);
    assert.deepEqual(plan.blocks, []);
    assert.equal(plan.reviewItems[0].kind, "unreadable_pdf");
  });
});

describe("HM3 on the 30 Oct email", () => {
  const body =
    "Hi All,\nPlease see today's internal show count attached.\n\n" +
    "On Enzo, we have sold an additional 57 tickets at £39.50 (£40.50 w/levy). Grand total sold for this event is 1974.\n\n" +
    "On Dusky Bristol we have sold an additional 258 tickets at the £5 + £1 levy rate at last count this morning. Grand total 738.";
  const sheet: ParsedSheet = { blocks: [], problems: [] };

  it("Enzo's two sentences give two items once Dusky Bristol is not a show we run, and neither writes a count", async () => {
    const pdf = parseInternalCountsItems(await extractPdfTextItems(new Uint8Array(read("internal-counts-2026-11-12.pdf"))));
    const withShows: ParsedSheet = {
      ...pdf,
      blocks: [...pdf.blocks, { ...pdf.blocks[0], index: 98, showName: "ENZO SIRAGUSA" }, { ...pdf.blocks[0], index: 99, showName: "DUSKY BRIS" }],
    };
    const all = planReport({ ...report, subject: "Internal Show Count 30.10.26", body }, sheet, ctx()).reviewItems;
    assert.equal(all.filter((i) => i.kind === "sale_mention").length, 4);
    const plan = planReport({ ...report, body }, withShows, ctx({ notOurs: new Set(["DUSKY BRIS"]) }));
    // The same sentences on the same count date never come back (M1b change 3).
    const again = planReport({ ...report, body }, withShows, ctx({ notOurs: new Set(["DUSKY BRIS"]), mentionSeen: (k) => plan.reviewItems.some((i) => i.detail.key === k) }));
    assert.equal(again.reviewItems.filter((i) => i.kind === "sale_mention").length, 0);
    const sales = plan.reviewItems.filter((i) => i.kind === "sale_mention");
    assert.deepEqual(
      sales.map((i) => [i.showName, i.detail.sentence]),
      [
        ["ENZO SIRAGUSA", "On Enzo, we have sold an additional 57 tickets at £39.50 (£40.50 w/levy)."],
        ["ENZO SIRAGUSA", "Grand total sold for this event is 1974."],
      ],
    );
    // The sale sentences add items only; the sheet's counts are what's written.
    assert.equal(plan.blocks.find((b) => b.showName === "IPC")!.paid, 1828);
  });
});

describe("M1b follow-ups", () => {
  let sheet: ParsedSheet;
  before(async () => {
    sheet = parseInternalCountsItems(await extractPdfTextItems(new Uint8Array(read("internal-counts-2026-11-12.pdf"))));
  });
  const withSchakDated = (date: string): ParsedSheet => ({
    ...sheet,
    blocks: sheet.blocks.map((b) => (b.showName === "SCHAK" ? { ...b, countDate: date, countDateText: "19/10/26" } : b)),
  });

  it("(a) a Re:/FW: subject's older date is ignored; the PDF date stands", () => {
    const plan = planReport({ ...report, subject: "Re: Internal Show Count 11.11.26", prefixed: true }, sheet, ctx());
    assert.equal(plan.reviewItems.filter((i) => i.kind === "date_mismatch").length, 0);
    assert.ok(plan.blocks.every((b) => b.status === "write"));
  });

  it("(a) a Re:/FW: subject date later than the PDF still holds the sheet", () => {
    const plan = planReport({ ...report, subject: "Re: Internal Show Count 13.11.26", prefixed: true, sentAt: "2026-11-13T10:00:00Z" }, sheet, ctx());
    assert.deepEqual(plan.reviewItems.find((i) => i.kind === "date_mismatch")!.detail, { sheetDate: "2026-11-12", subjectDate: "2026-11-13" });
    assert.ok(plan.blocks.every((b) => b.status === "held"));
  });

  it("(a) an original's subject is cross-checked as before", () => {
    const plan = planReport({ ...report, subject: "Internal Show Count 11.11.26" }, sheet, ctx());
    assert.equal(plan.reviewItems.filter((i) => i.kind === "date_mismatch").length, 1);
  });

  it("(b) the latest block date is the count date", () => {
    const plan = planReport(report, withSchakDated("2026-10-19"), ctx());
    assert.equal(plan.sheetDate, "2026-11-12");
  });

  it("(b) an older-dated block with moved figures is filed under the sheet's date, printed date kept, no item", () => {
    const plan = planReport(
      report,
      withSchakDated("2026-10-19"),
      ctx({ latestStored: (id) => (id === "id-NX26-SCHAK" ? { total: 1763, sentAt: null, blockId: "b", countDate: "2026-10-19" } : null) }),
    );
    const schak = plan.blocks.find((b) => b.showName === "SCHAK")!;
    assert.equal(schak.status, "write");
    assert.equal(schak.countDate, "2026-11-12");
    assert.equal(schak.printedDate, "2026-10-19");
    assert.equal(plan.reviewItems.filter((i) => i.showName === "SCHAK" && i.kind !== "since_last_mismatch").length, 0);
  });

  it("(b) an older-dated block with unchanged figures is skipped: nothing written, no SINCE LAST check", () => {
    const plan = planReport(
      report,
      withSchakDated("2026-10-19"),
      ctx({
        latestStored: (id) => (id === "id-NX26-SCHAK" ? { total: 1870, sentAt: null, blockId: "b", countDate: "2026-10-19" } : null),
        previous: () => ({ total: 1000, countDate: "2026-10-18", messageId: "m" }),
      }),
    );
    const schak = plan.blocks.find((b) => b.showName === "SCHAK")!;
    assert.equal(schak.status, "repeat");
    assert.equal(plan.reviewItems.filter((i) => i.showName === "SCHAK").length, 0);
  });

  it("ruling a: one block dated after the email was sent is held on its own; every other block is stored", () => {
    const plan = planReport(report, withSchakDated("2026-11-13"), ctx());
    assert.equal(plan.sheetDate, "2026-11-12");
    assert.equal(plan.reviewItems.filter((i) => i.kind === "date_mismatch").length, 0);
    const schak = plan.blocks.find((b) => b.showName === "SCHAK")!;
    assert.equal(schak.status, "held");
    assert.deepEqual(
      plan.reviewItems.filter((i) => i.kind === "block_after_sent").map((i) => [i.showName, i.detail]),
      [["SCHAK", { blockDate: "2026-11-13", sheetDate: "2026-11-12" }]],
    );
    const others = plan.blocks.filter((b) => b.showName !== "SCHAK");
    assert.equal(others.length, 8);
    assert.ok(others.every((b) => b.status === "write" && b.countDate === "2026-11-12"));
  });

  it("ruling a: the count date is the latest block date not after the send date", () => {
    const plan = planReport({ ...report, subject: "Internal Show Count", sentAt: "2026-11-11T18:00:00Z" }, withSchakDated("2026-11-11"), ctx());
    assert.equal(plan.sheetDate, "2026-11-11");
    assert.equal(plan.blocks.find((b) => b.showName === "SCHAK")!.status, "write");
    assert.ok(plan.blocks.filter((b) => b.showName !== "SCHAK").every((b) => b.status === "held"));
  });

  it("ruling d: a count arriving after a later one is noted on its items and opens none of its own", () => {
    const later = ctx({ latestStored: (id) => ({ total: 1, sentAt: null, blockId: `b-${id}`, countDate: "2026-11-13" }) });
    const plan = planReport(report, sheet, later);
    assert.deepEqual(
      plan.reviewItems.map((i) => [i.kind, i.showName]),
      [["price_looks_wrong", "IPC"]],
    );
    assert.deepEqual(plan.reviewItems[0].detail.lateArrival, { laterDate: "2026-11-13", filedDate: "2026-11-12" });
    assert.ok(plan.blocks.every((b) => b.status === "write"));
  });

  it("the SINCE LAST COUNT item carries our previous count's date and email", () => {
    const plan = planReport(report, sheet, ctx({ previous: () => ({ total: 1800, countDate: "2026-11-11", messageId: "m-11" }) }));
    const d = plan.reviewItems.find((i) => i.kind === "since_last_mismatch" && i.showName === "IPC")!.detail;
    assert.equal(d.previousDate, "2026-11-11");
    assert.equal(d.previousMessageId, "m-11");
  });
});
