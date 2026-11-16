import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { MATAS_USER_IDS } from "../../auth/operator-allowlist.ts";
import { resolveServerMetaToken } from "../server-token.ts";

const OPERATOR = MATAS_USER_IDS[0]!;
const MEMBER = "7d0c3f52-1b6e-4a9d-8e21-5f4a3c2b1d0e"; // invented client_users member
const ENV_TOKEN = "EAAenvtokenfortests";

function db(row: { provider_token: string } | null) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => q } as any;
}

const saved = process.env.META_ACCESS_TOKEN;
afterEach(() => {
  if (saved === undefined) delete process.env.META_ACCESS_TOKEN;
  else process.env.META_ACCESS_TOKEN = saved;
});

describe("resolveServerMetaToken: the agency token is for operators only", () => {
  it("a non-operator with no Facebook token never gets META_ACCESS_TOKEN", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    await assert.rejects(() => resolveServerMetaToken(db(null), MEMBER), /No Meta access token available/);
  });

  it("an operator with no Facebook token still falls back to META_ACCESS_TOKEN", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    const r = await resolveServerMetaToken(db(null), OPERATOR);
    assert.equal(r.source, "env");
    assert.equal(r.token, ENV_TOKEN);
  });

  it("a non-operator's own stored token is still used", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    const r = await resolveServerMetaToken(db({ provider_token: "EAAowntoken" }), MEMBER);
    assert.equal(r.source, "db");
    assert.equal(r.token, "EAAowntoken");
  });
});
