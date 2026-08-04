import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lookupAliasFailOpen } from "../safe-lookup.ts";
import { resolveInviteSegment } from "../resolve.ts";

describe("lookupAliasFailOpen", () => {
  it("returns null without calling fetch when segment is not slug-shaped", async () => {
    let called = false;
    const result = await lookupAliasFailOpen("BEkbaKi9HUS3Tjl1ULBbe1", async () => {
      called = true;
      return { is_active: true, active_invite_code: "NOPE" };
    });
    assert.equal(called, false);
    assert.equal(result.alias, null);
    assert.equal(result.lookupError, null);
  });

  it("returns the alias row on success", async () => {
    const result = await lookupAliasFailOpen("throwback", async () => ({
      is_active: true,
      active_invite_code: "IPCpHTE8JMu9JT5DenZglv",
    }));
    assert.deepEqual(result.alias, {
      is_active: true,
      active_invite_code: "IPCpHTE8JMu9JT5DenZglv",
    });
    assert.equal(result.lookupError, null);
  });

  it("on fetch throw: null alias + error, raw invite still passthroughs", async () => {
    const invite = "DHjPw1HRvipCu6S6ZT6d5P";
    // Mixed-case invite is not slug-shaped — lookup skipped entirely.
    const skipped = await lookupAliasFailOpen(invite, async () => {
      throw new Error("should not run");
    });
    assert.equal(skipped.alias, null);
    const out = resolveInviteSegment(invite, skipped.alias);
    assert.equal(out.kind, "passthrough");
    if (out.kind === "passthrough") assert.equal(out.inviteCode, invite);
  });

  it("on fetch throw for slug-shaped invite-length segment: still passthroughs", async () => {
    // Lowercase 8+ alnum is both slug-shaped and invite-shaped. Lookup throws
    // (table missing / DB down) → null → resolve must passthrough, not 500/404.
    const invite = "abcdefghij12";
    const result = await lookupAliasFailOpen(invite, async () => {
      throw new Error("relation wa_community_aliases does not exist");
    });
    assert.equal(result.alias, null);
    assert.ok(result.lookupError);
    const out = resolveInviteSegment(invite, result.alias);
    assert.deepEqual(out, {
      kind: "passthrough",
      status: 302,
      inviteCode: invite,
    });
  });

  it("on fetch throw for hyphenated slug: 404 (not a redirect somewhere odd)", async () => {
    const result = await lookupAliasFailOpen("throwback-madrid", async () => {
      throw new Error("connection timeout");
    });
    assert.equal(result.alias, null);
    const out = resolveInviteSegment("throwback-madrid", result.alias);
    assert.deepEqual(out, { kind: "not_found", status: 404 });
  });
});
