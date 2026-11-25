/**
 * Design (25 Nov, frames RA / RB / RE / RG): a number is never split from its
 * unit in the Retargeting panel. keep-whole.ts wraps each in a nowrap span and
 * never changes the words.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ReactElement } from "react";

import { keepWhole, keepWholeParts } from "../keep-whole.ts";

const whole = (text: string) => keepWholeParts(text).filter((part) => part.whole).map((part) => part.text);

describe("keep-whole: each pattern stays on one line", () => {
  for (const [text, kept] of [
    ["Page visitors · 30 days", "30 days"],
    ["Ticket-link visitors · 30, 90, 180 days", "180 days"],
    ["Page engagers · 12 pages", "12 pages"],
    ["Pixel on 3 of 12 pages", "3 of 12 pages"],
    ["Similar · 2 similar lists", "2 similar lists"],
    ["£12.40 per attributed purchase · 33 purchases", "33 purchases"],
    ["Bottom → Mid · £4.50 a day", "£4.50 a day"],
    ["Fixr below 1,000", "below 1,000"],
    ["Pool Below 1,000", "Below 1,000"],
    ["Skiddle 3,900–4,600 · RA 1,000–1,200", "3,900–4,600"],
    ["1 day", "1 day"],
    ["1 page", "1 page"],
    ["1 similar list", "1 similar list"],
    ["1 purchase", "1 purchase"],
    ["£1,204.00 a day", "£1,204.00 a day"],
  ] as const) {
    it(`"${text}" keeps "${kept}" whole`, () => {
      assert.ok(whole(text).includes(kept), JSON.stringify(keepWholeParts(text)));
    });
  }

  it("every range and every pattern in one line", () => {
    assert.deepEqual(whole("Skiddle 3,900–4,600 · RA 1,000–1,200 · Fixr below 1,000"), ["3,900–4,600", "1,000–1,200", "below 1,000"]);
    assert.deepEqual(whole("Frequency 6.4 on 3,900–4,600 · £12.00 → £7.50 a day, back to frequency 4 · £4.50 a day back to the plan"), ["3,900–4,600", "£7.50 a day", "£4.50 a day"]);
  });

  it("a date's non-breaking spaces (keepDates) and a number glued to a word are left alone", () => {
    assert.deepEqual(whole("Mon 16 Nov · day 4 · RT14 · 2026-11-25"), []);
    assert.deepEqual(whole("30 days"), ["30 days"]);
    assert.deepEqual(whole("30 days"), ["30 days"]);
  });

  it("never changes the words: the parts join back to the text", () => {
    for (const text of ["Ticket-link visitors · 30, 90, 180 days · leaves out buyers", "Pixel on 3 of 12 pages · Skiddle 3,900–4,600", "No figure", ""]) {
      assert.equal(keepWholeParts(text).map((part) => part.text).join(""), text);
    }
  });
});

describe("keep-whole: the markup", () => {
  it("a nowrap span around each kept run, the rest as written", () => {
    const node = keepWhole("Pool 3,900–4,600 · frequency 4.3") as ReactElement<{ children: (string | ReactElement<{ className: string; children: string; "data-keep-whole": string }>)[] }>;
    const [before, span, after] = node.props.children;
    assert.equal(before, "Pool ");
    assert.equal(after, " · frequency 4.3");
    assert.ok(typeof span !== "string");
    assert.equal(span.type, "span");
    assert.deepEqual(span.props, { className: "whitespace-nowrap", "data-keep-whole": "", children: "3,900–4,600" });
    assert.equal(keepWhole("Bottom"), "Bottom");
  });

  it("the panel runs every string through it (k), and the pool, leaves-out and purchases cells too", () => {
    const panel = readFileSync("components/dashboard/events/retargeting-panel.tsx", "utf8");
    assert.match(panel, /const k = \(text: string\) => keepWhole\(panelText\(text\)\);/);
    assert.match(panel, /data-pool>\{created \? k\(/);
    assert.match(panel, /row\.leavesOut \? k\(row\.leavesOut\)/);
    assert.match(panel, /k\(figure\(row\.purchases\)\)/);
  });
});
