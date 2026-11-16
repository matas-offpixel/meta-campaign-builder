import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inviteHomesAgree } from "../invite-homes.ts";
import {
  authoritativeDestination,
  resolveInviteSegment,
  whatsappCommunityRedirectUrl,
} from "../resolve.ts";
import {
  isValidInviteCode,
  isValidSlug,
  normaliseInviteInput,
} from "../slug.ts";

const THROWBACK_CODES = [
  "BEkbaKi9HUS3Tjl1ULBbe1",
  "DHjPw1HRvipCu6S6ZT6d5P",
  "HyDdYMsXYCv4WNQe5DeMuU",
] as const;

describe("slug + invite validation", () => {
  it("accepts current slugs, dotted runbook slugs, and mixed-case invite codes", () => {
    assert.equal(isValidSlug("throwback"), true);
    assert.equal(isValidSlug("throwback-madrid"), true);
    assert.equal(isValidSlug("fever105-sheffield"), true);
    assert.equal(isValidSlug("Throwback-Porto-17.10.26"), true);
    assert.equal(isValidSlug("Closa-Selects-Barcelona-30.10.26"), true);
    assert.equal(isValidSlug("BEkbaKi9HUS3Tjl1ULBbe1"), true);
  });

  it("rejects separators in the wrong place", () => {
    assert.equal(isValidSlug("-bad"), false);
    assert.equal(isValidSlug("bad-"), false);
    assert.equal(isValidSlug("bad."), false);
    assert.equal(isValidSlug(".bad"), false);
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

describe("authoritativeDestination", () => {
  it("reads the active destination and ignores a different cache", () => {
    const code = authoritativeDestination({
      is_active: true,
      active_invite_code: "CCCCCCCC33333333",
      destinations: [
        { invite_code: "AAAAAAAA11111111", is_active: false },
        { invite_code: "BBBBBBBB22222222", is_active: true },
      ],
    });
    assert.equal(code, "BBBBBBBB22222222");
  });

  it("uses the cache when an active alias has no destination row", () => {
    assert.equal(
      authoritativeDestination({
        is_active: true,
        active_invite_code: "C7WMSoEAPJL59FIY0iDJd2",
        destinations: [],
      }),
      "C7WMSoEAPJL59FIY0iDJd2",
    );
  });

  it("returns null when the alias is inactive even if a destination is flagged active", () => {
    assert.equal(
      authoritativeDestination({
        is_active: false,
        active_invite_code: "DdsCUNGsF1RAZlGXkA5L81",
        destinations: [{ invite_code: "DdsCUNGsF1RAZlGXkA5L81", is_active: true }],
      }),
      null,
    );
  });

  // wa_community_aliases on 16 Nov 2026. Cache-only rows have no destination.
  it("resolves every live slug to its active code", () => {
    const rows: {
      slug: string;
      is_active: boolean;
      active_invite_code: string | null;
      destination: string | null;
      expect: string | null;
    }[] = [
      { slug: "azyr-nx", is_active: true, active_invite_code: "H98f8mIfT864uOmirYlSbA", destination: "H98f8mIfT864uOmirYlSbA", expect: "H98f8mIfT864uOmirYlSbA" },
      { slug: "cdw", is_active: true, active_invite_code: "FwcMtg5zsqA4Z4sIOes2Cq", destination: "FwcMtg5zsqA4Z4sIOes2Cq", expect: "FwcMtg5zsqA4Z4sIOes2Cq" },
      { slug: "djez-nx", is_active: true, active_invite_code: "JbIuiMMi67O2Uk90W8Z1c3", destination: "JbIuiMMi67O2Uk90W8Z1c3", expect: "JbIuiMMi67O2Uk90W8Z1c3" },
      { slug: "dod-nx", is_active: true, active_invite_code: "C0S0mhgnJdEHLa0ibqlGDM", destination: "C0S0mhgnJdEHLa0ibqlGDM", expect: "C0S0mhgnJdEHLa0ibqlGDM" },
      { slug: "eed-nx", is_active: true, active_invite_code: "LBuE4GwEMt81hOx1KgB7Lx", destination: "LBuE4GwEMt81hOx1KgB7Lx", expect: "LBuE4GwEMt81hOx1KgB7Lx" },
      { slug: "ewanmcvicar-nx", is_active: true, active_invite_code: "Dl7VK7opleoKWbemaQFcW8", destination: null, expect: "Dl7VK7opleoKWbemaQFcW8" },
      { slug: "fever105-sheffield", is_active: true, active_invite_code: "DdsCUNGsF1RAZlGXkA5L81", destination: "DdsCUNGsF1RAZlGXkA5L81", expect: "DdsCUNGsF1RAZlGXkA5L81" },
      { slug: "folamour-nx", is_active: true, active_invite_code: "EyjMPWNJFuZ5RTJi8I4QPw", destination: "EyjMPWNJFuZ5RTJi8I4QPw", expect: "EyjMPWNJFuZ5RTJi8I4QPw" },
      { slug: "gds-sheffield", is_active: true, active_invite_code: "FknA5LDC4zD5rBPj7sWcmt", destination: "FknA5LDC4zD5rBPj7sWcmt", expect: "FknA5LDC4zD5rBPj7sWcmt" },
      { slug: "glitterbox-bristol", is_active: true, active_invite_code: "KtVHgTtmGxALxaKmWJOxwR", destination: null, expect: "KtVHgTtmGxALxaKmWJOxwR" },
      { slug: "ipc-nx", is_active: true, active_invite_code: "L4jN3AFWkKtI1FIS2yEXjX", destination: "L4jN3AFWkKtI1FIS2yEXjX", expect: "L4jN3AFWkKtI1FIS2yEXjX" },
      { slug: "kream-bristol", is_active: true, active_invite_code: "DLsK34iUMpC3sFDg80CQrd", destination: null, expect: "DLsK34iUMpC3sFDg80CQrd" },
      { slug: "locklead-nx", is_active: true, active_invite_code: "C7WMSoEAPJL59FIY0iDJd2", destination: null, expect: "C7WMSoEAPJL59FIY0iDJd2" },
      { slug: "lprhythm-sheffield", is_active: true, active_invite_code: "EPLTFhrSlOj3u3QZBE5b02", destination: null, expect: "EPLTFhrSlOj3u3QZBE5b02" },
      { slug: "mg-sheffield", is_active: true, active_invite_code: "GRhIHPpdO7T2d8JSt1ioBD", destination: "GRhIHPpdO7T2d8JSt1ioBD", expect: "GRhIHPpdO7T2d8JSt1ioBD" },
      { slug: "paulvandyk-nx", is_active: true, active_invite_code: "FcmnE27aoR649oO9QSz4MR", destination: "FcmnE27aoR649oO9QSz4MR", expect: "FcmnE27aoR649oO9QSz4MR" },
      { slug: "puzzle-circuit", is_active: true, active_invite_code: "EIRmWYF6uTVBBfXVE5vXxU", destination: "EIRmWYF6uTVBBfXVE5vXxU", expect: "EIRmWYF6uTVBBfXVE5vXxU" },
      { slug: "robbie-nx", is_active: true, active_invite_code: "CbtX589VmAg5vLilBrmeme", destination: "CbtX589VmAg5vLilBrmeme", expect: "CbtX589VmAg5vLilBrmeme" },
      { slug: "rudimental-nx", is_active: false, active_invite_code: null, destination: "DdsCUNGsF1RAZlGXkA5L81", expect: null },
      { slug: "schak-nx", is_active: true, active_invite_code: "D7AvqS8L27rKJwio2BhpJw", destination: "D7AvqS8L27rKJwio2BhpJw", expect: "D7AvqS8L27rKJwio2BhpJw" },
    ];
    assert.equal(rows.length, 20);
    for (const row of rows) {
      assert.equal(isValidSlug(row.slug), true, row.slug);
      const code = authoritativeDestination({
        is_active: row.is_active,
        active_invite_code: row.active_invite_code,
        destinations: row.destination
          ? [{ invite_code: row.destination, is_active: true }]
          : [],
      });
      assert.equal(code, row.expect, row.slug);
    }
  });
});

describe("resolveInviteSegment", () => {
  it("alias resolves to the destination code", () => {
    const out = resolveInviteSegment("throwback-madrid", {
      destination_invite_code: "IPCpHTE8JMu9JT5DenZglv",
    });
    assert.deepEqual(out, {
      kind: "alias",
      status: 302,
      slug: "throwback-madrid",
      inviteCode: "IPCpHTE8JMu9JT5DenZglv",
    });
  });

  it("mixed-case invite follows the alias when a destination is in force", () => {
    const code = "BEkbaKi9HUS3Tjl1ULBbe1";
    const out = resolveInviteSegment(code, {
      destination_invite_code: "CCCCCCCC33333333",
    });
    assert.equal(out.kind, "alias");
    if (out.kind === "alias") {
      assert.equal(out.inviteCode, "CCCCCCCC33333333");
      assert.notEqual(out.inviteCode, code);
    }
  });

  it("unaliased mixed-case invite passes through byte-identical", () => {
    for (const code of THROWBACK_CODES) {
      const out = resolveInviteSegment(code, null);
      assert.deepEqual(out, {
        kind: "passthrough",
        status: 302,
        inviteCode: code,
      });
      assert.equal(
        whatsappCommunityRedirectUrl(out.kind === "passthrough" ? out.inviteCode : ""),
        `https://chat.whatsapp.com/${code}?mode=gi_t`,
      );
    }
  });

  it("unknown well-formed slug passes through", () => {
    const out = resolveInviteSegment("unknown-brand", null);
    assert.deepEqual(out, {
      kind: "passthrough",
      status: 302,
      inviteCode: "unknown-brand",
    });
  });

  it("repointing changes destination with the same slug", () => {
    const slug = "jackies";
    const before = resolveInviteSegment(slug, {
      destination_invite_code: "AAAAAAAA11111111",
    });
    const after = resolveInviteSegment(slug, {
      destination_invite_code: "BBBBBBBB22222222",
    });
    assert.equal(before.kind, "alias");
    assert.equal(after.kind, "alias");
    if (before.kind === "alias" && after.kind === "alias") {
      assert.equal(before.slug, after.slug);
      assert.notEqual(before.inviteCode, after.inviteCode);
      assert.equal(after.inviteCode, "BBBBBBBB22222222");
    }
  });

  it("garbage is 404", () => {
    assert.deepEqual(resolveInviteSegment("!!bad!!", null), {
      kind: "not_found",
      status: 404,
    });
    assert.deepEqual(resolveInviteSegment("has space", null), {
      kind: "not_found",
      status: 404,
    });
  });

  it("builds WhatsApp redirect URL with the code unchanged", () => {
    assert.equal(
      whatsappCommunityRedirectUrl("BEkbaKi9HUS3Tjl1ULBbe1"),
      "https://chat.whatsapp.com/BEkbaKi9HUS3Tjl1ULBbe1?mode=gi_t",
    );
  });
});

describe("invite homes", () => {
  it("agrees when both are null or both hold the same code", () => {
    assert.equal(inviteHomesAgree(null, null), true);
    assert.equal(inviteHomesAgree("AAAAAAAA11111111", "AAAAAAAA11111111"), true);
  });

  it("disagrees when the cache and the active destination differ", () => {
    assert.equal(inviteHomesAgree(null, "DdsCUNGsF1RAZlGXkA5L81"), false);
    assert.equal(inviteHomesAgree("AAAAAAAA11111111", "BBBBBBBB22222222"), false);
    assert.equal(inviteHomesAgree("AAAAAAAA11111111", null), false);
  });
});
