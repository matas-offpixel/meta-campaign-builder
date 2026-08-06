import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getMailchimpBrandSender,
  listMailchimpBrandSenders,
  nxLovesSender,
} from "../brand-senders.ts";

describe("mailchimp brand senders", () => {
  it("resolves NX Loves to its confirmed audience and sender identity", () => {
    const s = getMailchimpBrandSender("nx-loves");
    assert.equal(s.audienceId, "d2e7c021a0");
    assert.equal(s.fromName, "NX Loves");
    assert.equal(s.replyTo, "hello@nxnewcastle.com");
  });

  it("is case- and whitespace-insensitive on lookup", () => {
    assert.equal(getMailchimpBrandSender("  NX-Loves  ").brand, "nx-loves");
  });

  it("throws a listing error for an unknown brand", () => {
    assert.throws(
      () => getMailchimpBrandSender("does-not-exist"),
      /Unknown Mailchimp brand sender .* Known brands: nx-loves/,
    );
  });

  it("does not derive fromName from the audience list name", () => {
    // Audience d2e7c021a0 is list-named "NX Newcastle"; the brand is "NX Loves".
    // Guards the regression this module exists to prevent.
    assert.notEqual(nxLovesSender.fromName, "NX Newcastle");
  });

  it("registers every brand under its own key", () => {
    for (const brand of listMailchimpBrandSenders()) {
      assert.equal(getMailchimpBrandSender(brand).brand, brand);
    }
  });
});
