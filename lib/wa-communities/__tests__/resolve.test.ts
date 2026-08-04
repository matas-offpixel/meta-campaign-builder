import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isValidInviteCode,
  isValidSlug,
  normaliseInviteInput,
} from "../slug.ts";
import {
  resolveInviteSegment,
  whatsappCommunityRedirectUrl,
} from "../resolve.ts";

describe("slug + invite validation", () => {
  it("accepts lowercase hyphenated slugs", () => {
    assert.equal(isValidSlug("throwback"), true);
    assert.equal(isValidSlug("throwback-madrid"), true);
    assert.equal(isValidSlug("j2-melodic"), true);
  });

  it("rejects invalid slug shapes", () => {
    assert.equal(isValidSlug("Throwback"), false);
    assert.equal(isValidSlug("-bad"), false);
    assert.equal(isValidSlug("bad-"), false);
    assert.equal(isValidSlug("has_under"), false);
    assert.equal(isValidSlug("has space"), false);
    assert.equal(isValidSlug(""), false);
  });

  it("accepts WhatsApp invite codes", () => {
    assert.equal(isValidInviteCode("IPCpHTE8JMu9JT5DenZglv"), true);
    assert.equal(isValidInviteCode("BEkbaKi9HUS3Tjl1ULBbe1"), true);
    assert.equal(isValidInviteCode("abcdefgh"), true);
  });

  it("rejects short or punctuated invite codes", () => {
    assert.equal(isValidInviteCode("short"), false);
    assert.equal(isValidInviteCode("has-hyphen1"), false);
    assert.equal(isValidInviteCode(""), false);
  });

  it("normalises pasted WhatsApp URLs", () => {
    assert.equal(
      normaliseInviteInput("https://chat.whatsapp.com/IPCpHTE8JMu9JT5DenZglv?mode=gi_t"),
      "IPCpHTE8JMu9JT5DenZglv",
    );
    assert.equal(
      normaliseInviteInput("IPCpHTE8JMu9JT5DenZglv"),
      "IPCpHTE8JMu9JT5DenZglv",
    );
  });
});

describe("resolveInviteSegment", () => {
  it("alias resolves to current destination", () => {
    const out = resolveInviteSegment("throwback-madrid", {
      is_active: true,
      active_invite_code: "IPCpHTE8JMu9JT5DenZglv",
    });
    assert.deepEqual(out, {
      kind: "alias",
      status: 302,
      slug: "throwback-madrid",
      inviteCode: "IPCpHTE8JMu9JT5DenZglv",
    });
  });

  it("unknown slug 404s (not invite-shaped)", () => {
    const out = resolveInviteSegment("unknown-brand", null);
    assert.deepEqual(out, { kind: "not_found", status: 404 });
  });

  it("inactive alias 404s", () => {
    const out = resolveInviteSegment("throwback", {
      is_active: false,
      active_invite_code: "IPCpHTE8JMu9JT5DenZglv",
    });
    assert.deepEqual(out, { kind: "not_found", status: 404 });
  });

  it("alias without destination 404s", () => {
    const out = resolveInviteSegment("throwback", {
      is_active: true,
      active_invite_code: null,
    });
    assert.deepEqual(out, { kind: "not_found", status: 404 });
  });

  it("raw invite code still passes through", () => {
    const code = "IPCpHTE8JMu9JT5DenZglv";
    const out = resolveInviteSegment(code, null);
    assert.deepEqual(out, {
      kind: "passthrough",
      status: 302,
      inviteCode: code,
    });
  });

  it("mixed-case invite bypasses slug lookup path and passthroughs", () => {
    // Mixed case fails SLUG_RE, so alias is never consulted.
    const code = "BEkbaKi9HUS3Tjl1ULBbe1";
    const out = resolveInviteSegment(code, {
      is_active: true,
      active_invite_code: "SHOULD_NOT_USE",
    });
    assert.equal(out.kind, "passthrough");
    if (out.kind === "passthrough") {
      assert.equal(out.inviteCode, code);
    }
  });

  it("repointing changes destination with same slug (no template change)", () => {
    const slug = "jackies";
    const before = resolveInviteSegment(slug, {
      is_active: true,
      active_invite_code: "AAAAAAAA11111111",
    });
    const after = resolveInviteSegment(slug, {
      is_active: true,
      active_invite_code: "BBBBBBBB22222222",
    });
    assert.equal(before.kind, "alias");
    assert.equal(after.kind, "alias");
    if (before.kind === "alias" && after.kind === "alias") {
      assert.equal(before.slug, after.slug);
      assert.notEqual(before.inviteCode, after.inviteCode);
      assert.equal(after.inviteCode, "BBBBBBBB22222222");
    }
  });

  it("lowercase invite-shaped unknown segment still passthroughs", () => {
    // 8+ lowercase alnum matches both slug + invite; unknown alias → passthrough.
    const out = resolveInviteSegment("abcdefghij", null);
    assert.deepEqual(out, {
      kind: "passthrough",
      status: 302,
      inviteCode: "abcdefghij",
    });
  });

  it("short non-hyphenated string (not invite-length) 404s", () => {
    // Fails INVITE_RE (<8 chars) but matches SLUG_RE — must not redirect.
    assert.deepEqual(resolveInviteSegment("hello", null), {
      kind: "not_found",
      status: 404,
    });
    assert.deepEqual(resolveInviteSegment("abc", null), {
      kind: "not_found",
      status: 404,
    });
    assert.deepEqual(resolveInviteSegment("short", null), {
      kind: "not_found",
      status: 404,
    });
  });

  it("garbage returns 400", () => {
    const out = resolveInviteSegment("!!bad!!", null);
    assert.deepEqual(out, { kind: "invalid", status: 400 });
  });

  it("builds WhatsApp redirect URL", () => {
    assert.equal(
      whatsappCommunityRedirectUrl("ABC12345"),
      "https://chat.whatsapp.com/ABC12345?mode=gi_t",
    );
  });
});
