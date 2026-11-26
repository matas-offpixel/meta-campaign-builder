/**
 * Design, 27 Nov (#1398 at 393): an event code (brackets included), "What
 * Claude asked" and a date with its time never break across a line on
 * Today. The words are never changed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayParts } from "../today/keep-whole.ts";

const whole = (text: string) => todayParts(text).filter((p) => p.whole).map((p) => p.text);

test("event codes, brackets included, stay whole; ids, ranges and names don't match", () => {
  assert.deepEqual(whole("[NX26-RUDIMENTAL] Retargeting: live → paused"), ["[NX26-RUDIMENTAL]"]);
  assert.deepEqual(whole("Change budget · NX27-GLITTERBOX"), ["NX27-GLITTERBOX"]);
  assert.deepEqual(whole("Pause ad set · P26-BDAY"), ["P26-BDAY"]);
  assert.deepEqual(whole("Asked: “Raise NX27-GLITTERBOX’s Retargeting · Bottom?”"), ["NX27-GLITTERBOX"]);
  assert.deepEqual(whole("Broad · 25–44: £20.00 → £30.00 a day"), []);
  assert.deepEqual(whole("Done · 2 ad sets changed · 120252675731800761, 120252675731800762"), []);
  assert.deepEqual(whole("“Broad 25-34” → “Broad 18-24”"), []);
});

test("“What Claude asked” and dates with their times stay whole", () => {
  assert.deepEqual(whole("Approved in Claude · Thu 26 Nov, 16:40 · What Claude asked"), ["Thu 26 Nov, 16:40", "What Claude asked"]);
  assert.deepEqual(whole("Ran as scheduled · Fri 27 Nov, 09:00"), ["Fri 27 Nov, 09:00"]);
  assert.deepEqual(whole("[A1-B] A vs [A1-C] B · 50/50 · Fri 27 Nov – Sat 19 Dec"), ["[A1-B]", "[A1-C]", "Fri 27 Nov", "Sat 19 Dec"]);
});

test("the words are never changed: the parts join back to the text", () => {
  for (const t of ["Undone by Matas · Thu 26 Nov, 11:05", "Start an A/B test · NX27-GLITTERBOX", "Nothing to keep", ""]) assert.equal(todayParts(t).map((p) => p.text).join(""), t);
});
