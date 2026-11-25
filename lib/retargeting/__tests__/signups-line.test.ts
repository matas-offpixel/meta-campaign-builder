/**
 * SU1: the Signups line in Bottom (docs/design-record/2026-11-25-signups-into-meta.html,
 * record #1373). Every string here is the words-rc list's su.line.* row as
 * written (words-rc-2026-11-24.tsv, 242 rows, sha256 61f69c94…ea78).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signupsLines } from "../plan.ts";
import { signupsSyncOf, type SignupsSyncRow } from "../runner.ts";
import * as words from "../words.ts";

const HAS = ["ticket-link visitors", "checkout starters", "registrations"];

describe("SU1: the words, from the list", () => {
  it("su.line.on and .one, with SU4's dates (London) and thousands", () => {
    assert.equal(words.signupsOn(412, "2026-11-25T08:00:00Z", "2026-11-24"), "Signups list · 412 signups · last sent Wed 25 Nov, 08:00 · rebuilt in full Tue 24 Nov");
    assert.equal(words.signupsOn(1204, "2026-11-25T08:00:00Z", "2026-11-24"), "Signups list · 1,204 signups · last sent Wed 25 Nov, 08:00 · rebuilt in full Tue 24 Nov");
    assert.equal(words.signupsOn(1, "2026-11-25T08:00:00Z", "2026-11-24"), "Signups list · 1 signup · last sent Wed 25 Nov, 08:00 · rebuilt in full Tue 24 Nov");
    // Summer: 07:00 UTC is 08:00 London.
    assert.equal(words.londonMoment("2026-07-01T07:00:00Z"), "Wed 1 Jul, 08:00");
  });

  it("su.line.waiting, .switch_off, .switch_off.none, .not_linked, .not_configured, .failed.*", () => {
    assert.equal(words.signupsWaiting("2026-11-27", HAS), "No signup list yet: it’s made on Fri 27 Nov, 08:00, so until then Bottom runs on ticket-link visitors, checkout starters and registrations only.");
    assert.equal(words.SIGNUPS_SWITCH_OFF, "Sending signups to Meta is switched off, so this list isn’t kept current.");
    assert.equal(words.SIGNUPS_SWITCH_OFF_NONE, "Sending signups to Meta is switched off, so the list won’t be made until it’s on.");
    assert.equal(words.signupsNotLinked("CQ-xmpl-roof"), "CIRQLIN has no page tagged CQ-xmpl-roof, so this show’s signups can’t be sent.");
    assert.equal(words.SIGNUPS_NOT_CONFIGURED, "The CIRQLIN read isn’t set up, so no signups are sent.");
    assert.equal(words.SIGNUPS_FAILED_READ, "The last run couldn’t read CIRQLIN, so nothing new was sent. The next run tries again tomorrow at 08:00.");
    assert.equal(words.signupsFailedSend(380, 412), "Meta took 380 of 412 signups in the last run. The next run sends the rest tomorrow at 08:00.");
    assert.equal(words.signupsFailedSend(0, 1), "Meta didn’t take the 1 signup in the last run. The next run sends it tomorrow at 08:00.");
  });

  it("su.line.not_on is RT15's line, unchanged", () => {
    assert.equal(words.noSignupList(HAS), "No signup list yet, so Bottom runs on ticket-link visitors, checkout starters and registrations only.");
  });
});

describe("SU1: one state at a time, then the lines under it", () => {
  const view = (lines: ReturnType<typeof signupsLines>) => lines.map((line) => [line.text, line.ochre ? "ochre" : line.muted ? "muted" : "brick", line.actions.length]);

  it("not switched on: RT15's line with its link, or nothing when a signups list was uploaded by hand", () => {
    assert.deepEqual(view(signupsLines(null, HAS, 0)), [[words.noSignupList(HAS), "brick", 1]]);
    assert.deepEqual(view(signupsLines({ state: "not_on" }, HAS, 0)), [[words.noSignupList(HAS), "brick", 1]]);
    assert.deepEqual(signupsLines({ state: "not_on" }, HAS, 1), []);
  });

  it("waiting and on read muted (set like the buyers line); writes off adds the ochre line", () => {
    assert.deepEqual(view(signupsLines({ state: "waiting", madeOn: "2026-11-27", writesOff: true }, HAS, 0)), [
      [words.signupsWaiting("2026-11-27", HAS), "muted", 0],
      [words.SIGNUPS_SWITCH_OFF_NONE, "ochre", 0],
    ]);
    assert.deepEqual(view(signupsLines({ state: "on", count: 412, lastSentAt: "2026-11-25T08:00:00Z", rebuiltOn: "2026-11-23", writesOff: true }, HAS, 1)), [
      ["Signups list · 412 signups · last sent Wed 25 Nov, 08:00 · rebuilt in full Mon 23 Nov", "muted", 0],
      [words.SIGNUPS_SWITCH_OFF, "ochre", 0],
    ]);
  });

  it("the brick states and lines", () => {
    assert.deepEqual(view(signupsLines({ state: "not_linked", tag: "CQ-xmpl-roof" }, HAS, 0)), [[words.signupsNotLinked("CQ-xmpl-roof"), "brick", 0]]);
    assert.deepEqual(view(signupsLines({ state: "not_configured" }, HAS, 0)), [[words.SIGNUPS_NOT_CONFIGURED, "brick", 0]]);
    assert.deepEqual(view(signupsLines({ state: "on", count: 412, lastSentAt: "2026-11-25T08:00:00Z", rebuiltOn: "2026-11-23", failedRead: true, failedSend: { taken: 380, sent: 412 } }, HAS, 1)).map((row) => row[1]), ["muted", "brick", "brick"]);
  });
});

describe("SU1: the state from customer_list_syncs", () => {
  const EVENT = { presale_at: "2026-11-27T09:00:00Z", general_sale_at: "2026-11-28T09:00:00Z", event_date: "2026-12-18" };
  const ENV = { OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: "true", CIRQLIN_PARTNER_HASHES_SECRET: "x" };
  const row = (over: Partial<SignupsSyncRow>): SignupsSyncRow => ({ event_id: "e", enabled: true, meta_audience_id: null, sent_total: 0, removed_total: 0, last_sent_at: null, last_replaced_at: null, created_at: "2026-11-20T08:00:00Z", ...over });

  it("no enabled row is not switched on", () => {
    assert.deepEqual(signupsSyncOf([], EVENT, ENV), { state: "not_on" });
    assert.deepEqual(signupsSyncOf([row({ enabled: false, meta_audience_id: "1" })], EVENT, ENV), { state: "not_on" });
  });

  it("enabled with no list: made on presale day (general sale with no presale)", () => {
    assert.deepEqual(signupsSyncOf([row({})], EVENT, ENV), { state: "waiting", madeOn: "2026-11-27", writesOff: false });
    assert.deepEqual(signupsSyncOf([row({})], { ...EVENT, presale_at: null }, ENV), { state: "waiting", madeOn: "2026-11-28", writesOff: false });
  });

  it("a list: what it holds now (sent less removed), the last send, the last rebuild else the day it was made", () => {
    assert.deepEqual(signupsSyncOf([row({ meta_audience_id: "1", sent_total: 430, removed_total: 18, last_sent_at: "2026-11-25T08:00:00Z", last_replaced_at: "2026-11-23T08:00:00Z" })], EVENT, ENV), { state: "on", count: 412, lastSentAt: "2026-11-25T08:00:00Z", rebuiltOn: "2026-11-23", writesOff: false });
    assert.equal((signupsSyncOf([row({ meta_audience_id: "1", sent_total: 3, last_sent_at: "2026-11-25T08:00:00Z" })], EVENT, ENV) as { rebuiltOn: string }).rebuiltOn, "2026-11-20");
  });

  it("writes off adds the ochre line; the CIRQLIN read unset is \"not set up\"", () => {
    assert.equal((signupsSyncOf([row({})], EVENT, { CIRQLIN_PARTNER_HASHES_SECRET: "x" }) as { writesOff: boolean }).writesOff, true);
    assert.deepEqual(signupsSyncOf([row({})], EVENT, { OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: "true" }), { state: "not_configured", writesOff: false });
  });
});
