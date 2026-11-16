import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveInviteSegment, whatsappCommunityRedirectUrl } from "../resolve.ts";
import { lookupAliasFailOpen } from "../safe-lookup.ts";

const THROWBACK_CODES = [
  "BEkbaKi9HUS3Tjl1ULBbe1",
  "DHjPw1HRvipCu6S6ZT6d5P",
  "HyDdYMsXYCv4WNQe5DeMuU",
] as const;

describe("lookupAliasFailOpen", () => {
  it("does not call fetch for a segment that is neither slug nor invite", async () => {
    let called = false;
    const result = await lookupAliasFailOpen("!!bad!!", async () => {
      called = true;
      return { destination_invite_code: "NOPE" };
    });
    assert.equal(called, false);
    assert.equal(result.alias, null);
    assert.equal(result.lookupError, null);
    assert.deepEqual(resolveInviteSegment("!!bad!!", result.alias), {
      kind: "not_found",
      status: 404,
    });
  });

  it("looks up mixed-case invite codes", async () => {
    let called = false;
    const result = await lookupAliasFailOpen("BEkbaKi9HUS3Tjl1ULBbe1", async () => {
      called = true;
      return { destination_invite_code: "CCCCCCCC33333333" };
    });
    assert.equal(called, true);
    assert.equal(result.lookupError, null);
    const out = resolveInviteSegment("BEkbaKi9HUS3Tjl1ULBbe1", result.alias);
    assert.equal(out.kind, "alias");
    if (out.kind === "alias") assert.equal(out.inviteCode, "CCCCCCCC33333333");
  });

  it("returns the alias row on success", async () => {
    const result = await lookupAliasFailOpen("throwback", async () => ({
      destination_invite_code: "IPCpHTE8JMu9JT5DenZglv",
    }));
    assert.deepEqual(result.alias, {
      destination_invite_code: "IPCpHTE8JMu9JT5DenZglv",
    });
    assert.equal(result.lookupError, null);
  });

  it("production Throwback raw invites pass through byte-identical when unaliased", async () => {
    for (const code of THROWBACK_CODES) {
      const result = await lookupAliasFailOpen(code, async () => null);
      const out = resolveInviteSegment(code, result.alias);
      assert.equal(out.kind, "passthrough");
      if (out.kind === "passthrough") {
        assert.equal(out.inviteCode, code);
        assert.equal(
          whatsappCommunityRedirectUrl(out.inviteCode),
          `https://chat.whatsapp.com/${code}?mode=gi_t`,
        );
      }
    }
  });

  it("on fetch throw, invite-shaped and slug-shaped segments both pass through", async () => {
    for (const segment of ["DHjPw1HRvipCu6S6ZT6d5P", "throwback-madrid"]) {
      const result = await lookupAliasFailOpen(segment, async () => {
        throw new Error("relation wa_community_aliases does not exist");
      });
      assert.equal(result.alias, null);
      assert.ok(result.lookupError);
      const out = resolveInviteSegment(segment, null);
      assert.deepEqual(out, {
        kind: "passthrough",
        status: 302,
        inviteCode: segment,
      });
    }
  });
});
