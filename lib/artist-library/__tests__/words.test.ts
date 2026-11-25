import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PHASES } from "../../learning/findings/phase.ts";
import { showPhase } from "../view.ts";
import { AL_WORDS, KIND_WORDS, PHASE_WORDS, costWords, countWords, dayWords, monthSpan } from "../words.ts";

const FIXTURE = new URL("./fixtures/words-al-2026-11-25.tsv", import.meta.url);

describe("AL words", () => {
  it("the fixture is the record's word list with design's phase and kind rows (125 rows, sha256 a814f332…8b6d)", () => {
    const bytes = readFileSync(FIXTURE);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), "a814f3322de1640619a3743c641f61dd71a0e91be58b574c638169e233338b6d");
    const rows = bytes.toString("utf8").trimEnd().split("\n").slice(1);
    assert.equal(rows.length, 125);
  });

  it("AL_WORDS holds every row exactly, and nothing else", () => {
    const rows = readFileSync(FIXTURE, "utf8").trimEnd().split("\n").slice(1).map((line) => line.split("\t"));
    assert.deepEqual(Object.keys(AL_WORDS), rows.map((r) => r[0]));
    for (const [key, , words] of rows) assert.equal(AL_WORDS[key as keyof typeof AL_WORDS], words, key);
  });

  it("every count has its one-form (AL6)", () => {
    assert.equal(countWords("shows", 1), "1 show");
    assert.equal(countWords("shows", 2), "2 shows");
    assert.equal(countWords("shareable", 1), "1 shareable file");
    assert.equal(countWords("purchases", 1_200), "1,200 purchases");
  });

  it("money, days and months as AL6 writes them", () => {
    assert.equal(costWords("signup", 2.1), "£2.10 per signup");
    assert.equal(costWords("on_sale", 1234.5), "£1,234.50 per purchase");
    assert.equal(dayWords("2026-12-27", "2026-11-25", true), "Sun 27 Dec 2026");
    assert.equal(dayWords("2026-11-25", "2026-11-25"), "Wed 25 Nov");
    assert.equal(dayWords("2027-02-19", "2026-11-25"), "Fri 19 Feb 2027");
    assert.deepEqual(monthSpan("2026-08-03", "2026-10-31"), { first: "Aug", last: "Oct 2026" });
    assert.deepEqual(monthSpan("2025-12-03", "2026-01-31"), { first: "Dec 2025", last: "Jan 2026" });
  });

  it("every phase and every kind has its row", () => {
    for (const phase of [...PHASES, "show_week", "done"] as const) {
      assert.equal(PHASE_WORDS[phase], AL_WORDS[`al.phase.${phase}`], phase);
      assert.ok(PHASE_WORDS[phase].trim(), phase);
    }
    assert.deepEqual(Object.keys(PHASE_WORDS).sort(), [...PHASES, "show_week", "done"].sort(), "no extra keys");
    for (const kind of ["clip", "static", "render"] as const) {
      assert.equal(KIND_WORDS[kind], AL_WORDS[`al.kind.${kind}`], kind);
      assert.ok(KIND_WORDS[kind].trim(), kind);
    }
    assert.deepEqual(Object.keys(KIND_WORDS).sort(), ["clip", "render", "static"]);
    assert.equal(PHASE_WORDS.done, "Done");
  });

  it("a show's phase: done once its date has passed, show week up to the show day, nothing when no date says", () => {
    const base = { id: "e", name: null, event_code: "X", client_id: null, venue_name: null, venue_city: null, status: null };
    const dated = { ...base, announcement_at: "2026-10-01T17:00:00Z", presale_at: "2026-10-08T09:00:00Z", general_sale_at: "2026-10-10T09:00:00Z" };
    const none = { ...base, announcement_at: null, presale_at: null, general_sale_at: null };
    assert.equal(showPhase({ ...dated, event_date: "2026-12-27" }, "2026-11-25"), "general_sale");
    assert.equal(showPhase({ ...dated, event_date: "2026-11-27" }, "2026-11-25"), "show_week", "NX26-GLOBAL on 25 Nov");
    assert.equal(showPhase({ ...none, event_date: "2026-10-31" }, "2026-11-25"), "done", "NX26-ENZO: past, no stored phase");
    // The boundary: on the show day it's show week; from the next London day it's done.
    assert.equal(showPhase({ ...dated, event_date: "2026-11-27" }, "2026-11-27"), "show_week");
    assert.equal(showPhase({ ...dated, event_date: "2026-11-27" }, "2026-11-28"), "done");
    assert.equal(showPhase({ ...none, event_date: "2026-12-27" }, "2026-11-25"), null, "upcoming with no stored phase: left out");
  });
});
