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

import { TEMPLATE_FRAME_WORDS, TEMPLATE_NAMES, TEMPLATE_WORDS, changedLine, footerLine, fw } from "../words.ts";

const RAW = readFileSync(new URL("./fixtures/words-rc-2026-11-24.tsv", import.meta.url));
const ROWS = RAW.toString("utf8")
  .trimEnd()
  .split("\n")
  .slice(1)
  .map((line) => line.split("\t"))
  .map(([key, where, words]) => ({ key: key!, where: where!, words: words! }));

const RECORD = readFileSync(new URL("../../../docs/design-record/2026-11-24-campaign-creator-replicate.html", import.meta.url), "utf8")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&nbsp;/g, " ");

describe("audience template words", () => {
  it("the fixture is the record's final list: 151 rows, sha256 49b811f7…89282", () => {
    assert.equal(createHash("sha256").update(RAW).digest("hex"), "49b811f7c9f88813ea10fb74aba1e0e9454527c45d5d092bc5f8a2310be89282");
    assert.equal(ROWS.length, 151);
    assert.equal(new Set(ROWS.map((r) => r.key)).size, 151);
  });

  it("every templates.* row is in words.ts, word for word", () => {
    const wanted = ROWS.filter((r) => r.key.startsWith("templates."));
    assert.equal(wanted.length, 16);
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
});
