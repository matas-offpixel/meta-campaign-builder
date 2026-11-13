import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { checkBlock, soldAndComps } from "../checks.ts";
import { extractPdfTextItems, type PdfTextItem } from "../pdf-text.ts";
import {
  parseCount,
  parseInternalCountsItems,
  parseMoneyPence,
  parseSheetDate,
  type ParsedSheet,
} from "../parse.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, FIXTURES));

const SHA = {
  "internal-counts-2026-10-05.pdf": "b0be581a5e09e64fc96c3c547a3351603555e5e1a9f69922d29380c3149272f5",
  "internal-counts-2026-11-11.pdf": "b467486e08bf395a09b18fd12b47a444f33e0fb742fee202e435f6bf44817de0",
  "internal-counts-2026-11-12.pdf": "5b18d381df97dbcc33b2e5684fd30521293711b4a393a18f46b31ab7cd30e42a",
};

async function parseFixture(name: string): Promise<ParsedSheet> {
  return parseInternalCountsItems(await extractPdfTextItems(new Uint8Array(read(name))));
}

const byShow = (sheet: ParsedSheet) => new Map(sheet.blocks.map((b) => [b.showName, b]));

describe("fixtures", () => {
  it("are the samples from the brief", () => {
    for (const [name, sha] of Object.entries(SHA)) {
      assert.equal(createHash("sha256").update(read(name)).digest("hex"), sha, name);
    }
  });
});

describe("12 Nov sheet", () => {
  let sheet: ParsedSheet;
  before(async () => {
    sheet = await parseFixture("internal-counts-2026-11-12.pdf");
  });

  it("finds the nine shows, across both pages", () => {
    assert.deepEqual(
      sheet.blocks.map((b) => b.showName),
      ["IPC", "EAST END DUBS", "D.O.D", "SCHAK", "RUDIMENTAL", "ROBBIE DOHERTY", "KREAM", "Julian Fijma", "LOCKLEAD"],
    );
    assert.equal(byShow(sheet).get("LOCKLEAD")!.page, 2);
    assert.deepEqual(sheet.problems, []);
  });

  it("reads the totals in the brief", () => {
    const want: Record<string, number> = {
      IPC: 1828,
      "EAST END DUBS": 1731,
      "D.O.D": 932,
      SCHAK: 1870,
      RUDIMENTAL: 717,
      "ROBBIE DOHERTY": 497,
      KREAM: 336,
      "Julian Fijma": 579,
      LOCKLEAD: 372,
    };
    for (const b of sheet.blocks) assert.equal(b.totals?.total, want[b.showName], b.showName);
  });

  it("reproduces the model's v6 CSV counts for every NX show", () => {
    const rows = read("model-v6-counts-2026-11-12.csv").toString().trim().split("\n").slice(1);
    const nameFor: Record<string, string> = {
      "NX26-IPC": "IPC",
      "NX26-EED": "EAST END DUBS",
      "NX26-DOD": "D.O.D",
      "NX26-SCHAK": "SCHAK",
      "NX26-RUDIMENTAL": "RUDIMENTAL",
      "NX26-ROBBIEDOHERTY": "ROBBIE DOHERTY",
      "NX27-JULIANFIJMA": "Julian Fijma",
      "NX26-LOCKLEAD": "LOCKLEAD",
    };
    assert.equal(rows.length, 8);
    for (const row of rows) {
      const [code, , date, sold] = row.split(",");
      const block = byShow(sheet).get(nameFor[code])!;
      assert.equal(block.countDate, date, code);
      assert.equal(soldAndComps(block).paid, Number(sold), code);
    }
  });

  it("passes every check except IPC's prices (every tier fires, M4)", () => {
    for (const b of sheet.blocks) {
      const check = checkBlock(b);
      assert.deepEqual(check.unreadable, [], b.showName);
      assert.equal(check.sum, null, b.showName);
      assert.deepEqual(check.revenueMismatch, [], b.showName);
      assert.equal(check.revenueHeld, b.showName === "IPC", b.showName);
    }
    const ipc = checkBlock(byShow(sheet).get("IPC")!);
    assert.deepEqual(ipc.priceFlags.map((f) => f.position), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(ipc.priceFlags[0], {
      position: 1,
      tierName: "1ST",
      outlet: "SKIDDLE",
      pricePence: 20000,
      count: 200,
      reason: "equals_count",
      ceilingPence: 15000,
    });
  });

  it("flags a price above the event's dearest paid tier, with £150 only as the fallback", () => {
    const eed = byShow(sheet).get("EAST END DUBS")!;
    assert.equal(checkBlock(eed).priceFlags.length, 0);
    assert.deepEqual(
      checkBlock(eed, 26_00).priceFlags.map((f) => [f.tierName, f.reason]),
      [["3rd", "above_ceiling"]],
    );
  });

  it("reads both date forms from TIER TOTALS, day first: 12/11/2026 on IPC, 12/11/26 elsewhere", () => {
    for (const b of sheet.blocks) {
      assert.equal(b.countDateText, b.showName === "IPC" ? "12/11/2026" : "12/11/26", b.showName);
      assert.equal(b.countDate, "2026-11-12");
    }
  });

  it("keys repeated tier names by position", () => {
    const rud = byShow(sheet).get("RUDIMENTAL")!;
    assert.deepEqual(
      rud.tiers.map((t) => t.key),
      ["1:1st", "2:2nd", "3:3rd", "4:Final", "5:5th", "6:Final", "7:Group", "8:"],
    );
    assert.equal(byShow(sheet).get("ROBBIE DOHERTY")!.tiers[2].key, "3:Final");
  });

  it("keeps a blank cell null and a printed 0 as 0", () => {
    const ipc = byShow(sheet).get("IPC")!;
    const fatsoma = ipc.outlets.find((o) => o.outlet === "FATSOMA")!;
    const universe = ipc.outlets.find((o) => o.outlet === "UNIVERSE")!;
    assert.equal(fatsoma.cells[0], 0);
    assert.equal(universe.cells[0], null);
    assert.deepEqual(
      ipc.outlets.map((o) => o.outlet),
      ["SKIDDLE", "UNIVERSE", "FATSOMA", "DICE", "SEE", "GIGANTIC", "RA", "FIXR"],
    );
  });

  it("marks -£1.00 tiers unused and stores SINCE LAST COUNT", () => {
    const eed = byShow(sheet).get("EAST END DUBS")!;
    assert.deepEqual(
      eed.tiers.map((t) => t.unused),
      [false, false, false, true, true, true, true, true],
    );
    assert.equal(eed.totals?.sinceLast, 46);
    assert.equal(eed.outlets[0].sinceLast, 36);
  });
});

describe("11 Nov sheet, and the delta to 12 Nov", () => {
  it("parses, and ours minus 11 Nov equals their SINCE LAST COUNT for every show", async () => {
    const d11 = byShow(await parseFixture("internal-counts-2026-11-11.pdf"));
    const d12 = await parseFixture("internal-counts-2026-11-12.pdf");
    assert.equal(d11.size, 9);
    for (const b of d12.blocks) {
      const prev = d11.get(b.showName)!;
      assert.equal(prev.countDate, "2026-11-11");
      assert.equal(b.totals!.total! - prev.totals!.total!, b.totals!.sinceLast, b.showName);
    }
  });

  it("reads 11/11/26 on every block, day first", async () => {
    const d11 = await parseFixture("internal-counts-2026-11-11.pdf");
    for (const b of d11.blocks) {
      assert.equal(b.countDateText, "11/11/26", b.showName);
      assert.equal(b.countDate, "2026-11-11", b.showName);
    }
  });

  it("passes every check; IPC's prices repeat its Skiddle counts there too", async () => {
    const d11 = await parseFixture("internal-counts-2026-11-11.pdf");
    for (const b of d11.blocks) {
      const check = checkBlock(b);
      assert.equal(check.sum, null, b.showName);
      assert.deepEqual(check.unreadable, [], b.showName);
      assert.equal(check.revenueHeld, b.showName === "IPC", b.showName);
    }
  });
});

describe("5 Oct sheet (DJ EZ's final count, from the \"Fw: Internal Counts 05.10.26\" email)", () => {
  it("reads DJ EZ as 305 paid plus 218 comps", async () => {
    const sheet = await parseFixture("internal-counts-2026-10-05.pdf");
    const djez = byShow(sheet).get("DJ EZ")!;
    assert.equal(djez.countDate, "2026-10-05");
    assert.equal(djez.totals?.total, 523);
    assert.deepEqual(soldAndComps(djez), { paid: 305, comps: 218, total: 523 });
    assert.deepEqual(
      djez.tiers.filter((t) => t.comp).map((t) => t.name),
      ["Guest List", "VIP Free"],
    );
    // VIP Free is a comp priced -£1.00: counted as comps, left out of revenue, no item.
    const check = checkBlock(djez);
    assert.equal(check.sum, null);
    assert.equal(check.revenueHeld, false);
  });

  it("reads 16 shows over 3 pages; payment-plan columns don't hold a show whose tiers still sum to its total", async () => {
    const sheet = await parseFixture("internal-counts-2026-10-05.pdf");
    assert.equal(sheet.blocks.length, 16);
    assert.deepEqual(sheet.blocks.filter((b) => checkBlock(b).sum).map((b) => b.showName), []);
    assert.equal(byShow(sheet).get("RUDIMENTAL")!.countDate, "2026-10-01");
  });
});

describe("comps", () => {
  it("never count as sold", () => {
    const sheet = parseInternalCountsItems(syntheticSheet());
    const [block] = sheet.blocks;
    assert.equal(checkBlock(block).sum, null);
    assert.deepEqual(
      block.tiers.map((t) => t.comp),
      [false, true, true],
    );
    assert.deepEqual(soldAndComps(block), { paid: 305, comps: 218, total: 523 });
  });
});

describe("cell parsers", () => {
  it("parse money, counts and dates", () => {
    assert.equal(parseMoneyPence("£40,000.00"), 4_000_000);
    assert.equal(parseMoneyPence("-£1.00"), -100);
    assert.equal(parseMoneyPence("£13,072.50"), 1_307_250);
    assert.equal(parseCount("1,828"), 1828);
    assert.equal(parseCount("0"), 0);
    assert.equal(parseCount("£3.00"), null);
    assert.equal(parseSheetDate("12/11/26"), "2026-11-12");
    assert.equal(parseSheetDate("12/11/2026"), "2026-11-12");
    assert.equal(parseSheetDate("31/13/26"), null);
  });
});

/**
 * A DJ EZ-shaped block (523 = 305 paid + 129 guest list + 89 VIP comps),
 * with the 12 Nov sheet's geometry.
 */
function syntheticSheet(): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const put = (x: number, y: number, str: string, width = str.length * 4) =>
    items.push({ page: 1, x, y, width, str });
  const cols = [141, 189, 235];
  put(79, 767, "DJ EZ");
  ["Final", "Guest List", "VIP Comps"].forEach((s, i) => put(cols[i], 767, s));
  put(470, 767, "TOTAL", 15);
  put(498, 767, "SINCE LAST COUNT", 44);
  ["£20.00", "£4.00", "£0.00"].forEach((s, i) => put(cols[i] - 4, 759, s));
  put(75, 752, "SKIDDLE");
  ["305", "129", "89"].forEach((s, i) => put(cols[i], 752, s));
  put(473, 752, "523");
  put(518, 752, "0");
  put(80, 744, "FIXR");
  put(476, 744, "0");
  put(518, 744, "0");
  ["305", "129", "89"].forEach((s, i) => put(cols[i], 737, s));
  put(473, 737, "523");
  put(518, 737, "0");
  put(71, 733, "TIER TOTALS");
  ["£6,100.00", "£516.00", "£0.00"].forEach((s, i) => put(cols[i] - 6, 729, s));
  put(465, 729, "£6,616.00");
  put(511, 729, "05/10/26");
  return items;
}
