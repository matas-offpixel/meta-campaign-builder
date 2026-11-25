/**
 * The words are the record's (2026-11-24-campaign-creator-replicate, word
 * list = words-rc-2026-11-24.tsv, copied here as the fixture). Every
 * templates.* row must be in lib/audience-templates/words.ts with identical
 * text, and the module must hold nothing the list doesn't. The item lines
 * the list doesn't carry come from frame RC-E and must appear in the record.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TEMPLATE_FRAME_WORDS,
  TEMPLATE_NAMES,
  TEMPLATE_WORDS,
  addedLines,
  changedLine,
  createButtonLabel,
  createdLines,
  footerLine,
  fw,
  heldLine,
  madeOnLine,
  pickedLine,
  pickerPresetLine,
  signupsLine,
} from "../words.ts";

const RAW = readFileSync(new URL("./fixtures/words-rc-2026-11-24.tsv", import.meta.url));
const ROWS = RAW.toString("utf8")
  .trimEnd()
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"))
  .map(([key, where, words]) => ({ key: key!, where: where!, words: words! }));

const SU_RECORD = readFileSync(new URL("../../../docs/design-record/2026-11-25-signups-into-meta.html", import.meta.url), "utf8")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ");

const RECORD = readFileSync(new URL("../../../docs/design-record/2026-11-24-campaign-creator-replicate.html", import.meta.url), "utf8")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;/g, " ");

describe("audience template words", () => {
  it("the fixture is the record's final list: 252 rows, sha256 e4de6728…4bb01", () => {
    assert.equal(createHash("sha256").update(RAW).digest("hex"), "e4de67283a548f8d3f13a2fa2c5fc0f8624b8d9b2d57ce40dd819a4612bb4701");
    assert.equal(ROWS.length, 252);
    assert.equal(new Set(ROWS.map((r) => r.key)).size, 252);
  });

  it("every templates.* row is in words.ts, word for word", () => {
    const wanted = ROWS.filter((r) => r.key.startsWith("templates."));
    assert.equal(wanted.length, 42);
    for (const r of wanted) assert.equal((TEMPLATE_WORDS as Record<string, string>)[r.key], r.words, r.key);
  });

  it("words.ts holds no string that isn't in the list", () => {
    const list = new Map(ROWS.map((r) => [r.key, r.words]));
    for (const [key, words] of Object.entries(TEMPLATE_WORDS)) assert.equal(list.get(key), words, key);
  });

  it("the template names are the record's four, in order", () => {
    assert.deepEqual(TEMPLATE_NAMES, ["House & disco", "House & garage", "Techno", "Commercial house"]);
  });

  it("every frame line, filled with RC-E's values, is drawn in the record", () => {
    const filled = [
      fw("frame.tab.audiences"),
      fw("frame.list.line", { role: "buyers", family: "house_tech" }),
      fw("frame.list.line", { role: "buyers", family: "disco" }),
      fw("frame.pool.page_views"),
      fw("frame.pool.signups"),
      fw("frame.pool.video_viewers"),
      fw("frame.pool.pixel.line", { pixel: "NX Loves", days: 30 }),
      fw("frame.pool.pixel.line", { pixel: "NX Loves", days: 180 }),
      fw("frame.pool.video.line", { threshold: 50, days: 30 }),
      fw("frame.page.line", { days: 365 }),
      fw("frame.interests.line", { n: 3 }),
    ];
    for (const line of filled) assert.ok(RECORD.includes(line), line);
    assert.equal(Object.keys(TEMPLATE_FRAME_WORDS).length, 10);
  });

  it("the footer and the change line read as RC-E draws them", () => {
    assert.equal(
      footerLine(9, 3, "NX Promoter", false),
      "9 reused · 3 will be created in NX Promoter. Creating audiences is switched off, so these 3 wait.",
    );
    assert.ok(RECORD.includes(footerLine(9, 3, "NX Promoter", false)));
    assert.equal(footerLine(9, 3, "NX Promoter", true), "9 reused · 3 will be created in NX Promoter");
    assert.equal(footerLine(9, 0, "NX Promoter", false), "9 reused · 0 will be created in NX Promoter");
    assert.equal(changedLine(1), "1 change since this template was saved");
    assert.equal(changedLine(2), "2 changes since this template was saved");
    assert.ok(RECORD.includes(changedLine(1)));
  });

  it("the held line is the list's row, filled with Meta's account name", () => {
    const row = ROWS.find((r) => r.key === "templates.item.held");
    assert.deepEqual(row, { key: "templates.item.held", where: "Item, list held in another account", words: "held in {Meta account name}" });
    assert.equal(heldLine("Electric Bristol Live"), "held in Electric Bristol Live");
  });

  it("SU2's lines: the count with separators, one form for 1, none before the list is made", () => {
    assert.equal(signupsLine("NX27-GLITTERBOX", 1204), "Customer list · role: signups · NX27-GLITTERBOX · 1,204 signups");
    assert.equal(signupsLine("NX27-GLITTERBOX", 412), "Customer list · role: signups · NX27-GLITTERBOX · 412 signups");
    assert.equal(signupsLine("NX27-GLITTERBOX", 1), "Customer list · role: signups · NX27-GLITTERBOX · 1 signup");
    assert.equal(signupsLine("NX27-SILVABUMPA", null), "Customer list · role: signups · NX27-SILVABUMPA");
    assert.equal(madeOnLine("Thu 27 Nov"), "Made on Thu 27 Nov");
  });

  it("Add's lines, with their one-forms", () => {
    assert.deepEqual(addedLines("House & disco", "[NX27-GLITTERBOX] PURCHASE", 9, 0), ["Added House & disco to [NX27-GLITTERBOX] PURCHASE: 9 audiences."]);
    assert.deepEqual(addedLines("Techno", "D", 1, 1), ["Added Techno to D: 1 audience.", "1 isn’t made yet, so it’s left out."]);
    assert.deepEqual(addedLines("Techno", "D", 4, 3), ["Added Techno to D: 4 audiences.", "3 aren’t made yet, so they’re left out."]);
  });

  it("Create's button and lines, with their one-forms", () => {
    assert.equal(createButtonLabel(6, "Electric Studios Sheffield"), "Create 6 audiences in Electric Studios Sheffield");
    assert.equal(createButtonLabel(1, "NX Promoter"), "Create 1 audience in NX Promoter");
    assert.deepEqual(createdLines(6, 0, "NX Promoter"), ["Created 6 in NX Promoter."]);
    assert.deepEqual(createdLines(1, 0, "NX Promoter"), ["Created 1 in NX Promoter."]);
    assert.deepEqual(createdLines(4, 2, "NX Promoter"), ["Created 4 in NX Promoter.", "2 weren’t created. Try again."]);
    assert.deepEqual(createdLines(0, 1, "NX Promoter"), ["1 wasn’t created. Try again."]);
  });

  it("every new line is a row's words with only its braces filled", () => {
    const rows = new Map(ROWS.map((r) => [r.key, r.words]));
    for (const key of ["templates.item.signups.waiting", "templates.apply", "templates.create_button.one", "templates.created", "templates.create_failed"]) {
      assert.ok(rows.has(key), key);
    }
  });

  it("video-viewer items read as record #1373's RC-E draws them", () => {
    assert.equal(pickedLine(3, "NX26-LOCKLEAD"), "3 videos picked from NX26-LOCKLEAD");
    assert.equal(pickedLine(1, "NX26-LOCKLEAD"), "1 video picked from NX26-LOCKLEAD");
    assert.equal(pickerPresetLine("House & disco", 50, 30), "From House & disco: 50% watched · 30 days. Pick this show’s videos.");
    const before = footerLine(9, 1, "NX Promoter", false, 1);
    assert.equal(before, "9 reused · 1 will be created in NX Promoter · 1 needs videos picked. Creating audiences is switched off, so this one waits.");
    const after = footerLine(9, 2, "NX Promoter", false, 0);
    assert.equal(after, "9 reused · 2 will be created in NX Promoter. Creating audiences is switched off, so these 2 wait.");
    for (const line of [pickedLine(3, "NX26-LOCKLEAD"), pickerPresetLine("House & disco", 50, 30), "9 reused · 1 will be created in NX Promoter · 1 needs videos picked.", "9 reused · 2 will be created in NX Promoter."]) {
      assert.ok(SU_RECORD.includes(line), line);
    }
  });

  it("the footer with only video viewers left: no create part, the k part only", () => {
    assert.equal(footerLine(10, 0, "NX Promoter", false, 1), "10 reused · 1 needs videos picked");
    assert.equal(footerLine(3, 0, "NX Promoter", false, 2), "3 reused · 2 need videos picked");
    assert.equal(footerLine(3, 4, "Electric Studios Sheffield", true, 2), "3 reused · 4 will be created in Electric Studios Sheffield · 2 need videos picked");
  });
});
