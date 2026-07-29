/**
 * Per-brand sender identity.
 *
 * The load-bearing property: there is NO fallback. Shipping a client's
 * campaign from the agency address is invisible until someone replies to the
 * wrong inbox — one Madrid campaign went out that way before this existed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAILCHIMP_BRAND_SENDERS,
  resolveBrandSender,
  UnmappedBrandSenderError,
} from "../brand-senders.ts";

const AUDIENCES = {
  hop: "27eb062177", throwback: "c2b4d77acb", jackies: "08fe70fa49",
  kinyxx: "3cbfdc697d", fury: "bf1b94dd15", petardeo: "7e381bfe81", cmd: "89671d9d97",
};

test("every brand resolves to its own from-name and reply-to", () => {
  assert.deepEqual(resolveBrandSender(AUDIENCES.hop), { brand: "Hop on the Top", fromName: "Hop on the Top", replyTo: "info@hoponthetop.party" });
  assert.deepEqual(resolveBrandSender(AUDIENCES.throwback), { brand: "Throwback", fromName: "Throwback", replyTo: "hello@throwbackbcn.com" });
  assert.deepEqual(resolveBrandSender(AUDIENCES.jackies), { brand: "Jackies", fromName: "Jackies", replyTo: "info@jackiesmusic.com" });
  assert.deepEqual(resolveBrandSender(AUDIENCES.kinyxx), { brand: "KINYXX", fromName: "KINYXX", replyTo: "info@kinyxx.com" });
  assert.deepEqual(resolveBrandSender(AUDIENCES.fury), { brand: "Fury", fromName: "Fury", replyTo: "hello@furybarcelona.com" });
  assert.deepEqual(resolveBrandSender(AUDIENCES.petardeo), { brand: "Petardeo", fromName: "Petardeo", replyTo: "hello@petardeobcn.com" });
});

test("Coffee Morning Dance keeps the one-e 'coffe' domain verbatim", () => {
  const s = resolveBrandSender(AUDIENCES.cmd);
  assert.equal(s.replyTo, "hello@coffemorningdance.com");
  // Guard against a well-meaning spelling "fix".
  assert.ok(!s.replyTo.includes("coffee"), "domain was corrected — it must stay 'coffe'");
});

test("an unmapped audience THROWS — never falls back to the agency address", () => {
  assert.throws(() => resolveBrandSender("aa8d819989"), UnmappedBrandSenderError); // The 90s Party
  assert.throws(() => resolveBrandSender("d70fd8a68e"), UnmappedBrandSenderError); // Afrodanz
  assert.throws(() => resolveBrandSender("nope"), UnmappedBrandSenderError);
});

test("the unmapped error names the audience and lists what IS mapped", () => {
  try {
    resolveBrandSender("aa8d819989");
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof UnmappedBrandSenderError);
    assert.match(e.message, /aa8d819989/);
    assert.match(e.message, /27eb062177/);
    assert.match(e.message, /Refusing/);
  }
});

test("the agency default appears nowhere in the mapping", () => {
  for (const [id, s] of Object.entries(MAILCHIMP_BRAND_SENDERS)) {
    assert.ok(!/offpixel\.co\.uk/i.test(s.replyTo), `${id} (${s.brand}) still uses the agency address`);
    assert.match(s.replyTo, /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, `${id} reply_to is not a valid address`);
    assert.ok(s.fromName.trim().length > 0, `${id} has an empty from_name`);
  }
});

test("ids are trimmed, not otherwise normalised", () => {
  assert.equal(resolveBrandSender("  27eb062177  ").brand, "Hop on the Top");
  // Case is significant — Mailchimp audience ids are opaque.
  assert.throws(() => resolveBrandSender("27EB062177"), UnmappedBrandSenderError);
});
