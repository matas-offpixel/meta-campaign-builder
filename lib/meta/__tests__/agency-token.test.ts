import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { MATAS_USER_IDS } from "../../auth/operator-allowlist.ts";
import { agencyMetaToken, mayUseAgencyMetaToken, NO_META_TOKEN_MESSAGE } from "../agency-token.ts";
import { resolveServerMetaToken } from "../server-token.ts";

const OPERATOR = MATAS_USER_IDS[0]!;
const STAFF_OPERATOR = "4aa59005-5c1d-495c-8029-8c9453950c4d";
const MEMBER = "7d0c3f52-1b6e-4a9d-8e21-5f4a3c2b1d0e"; // invented client_users member
const ENV_TOKEN = "EAAenvtokenfortests";

const saved = process.env.META_ACCESS_TOKEN;
afterEach(() => {
  if (saved === undefined) delete process.env.META_ACCESS_TOKEN;
  else process.env.META_ACCESS_TOKEN = saved;
});

function tokensDb(row: { provider_token: string } | null) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => q } as any;
}

describe("agencyMetaToken", () => {
  it("gives the env token to operators only", () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    assert.equal(agencyMetaToken(OPERATOR), ENV_TOKEN);
    assert.equal(agencyMetaToken(STAFF_OPERATOR), ENV_TOKEN);
    assert.equal(agencyMetaToken(MEMBER), null);
    assert.equal(agencyMetaToken(null), null);
    assert.equal(agencyMetaToken(undefined), null);
    assert.equal(mayUseAgencyMetaToken(MEMBER), false);
    assert.equal(mayUseAgencyMetaToken(OPERATOR), true);
  });

  it("is null when the env token is unset, even for an operator", () => {
    delete process.env.META_ACCESS_TOKEN;
    assert.equal(agencyMetaToken(OPERATOR), null);
  });
});

describe("resolveServerMetaToken", () => {
  it("non-operator with no stored token: no fallback, the existing error", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    await assert.rejects(() => resolveServerMetaToken(tokensDb(null), MEMBER), (e: Error) => e.message === NO_META_TOKEN_MESSAGE);
  });

  it("operator with no stored token: unchanged, falls back to META_ACCESS_TOKEN", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    for (const id of [OPERATOR, STAFF_OPERATOR]) {
      const r = await resolveServerMetaToken(tokensDb(null), id);
      assert.equal(r.source, "env");
      assert.equal(r.token, ENV_TOKEN);
    }
  });

  it("stored tokens are unchanged for everyone", async () => {
    process.env.META_ACCESS_TOKEN = ENV_TOKEN;
    for (const id of [OPERATOR, MEMBER]) {
      const r = await resolveServerMetaToken(tokensDb({ provider_token: "EAAowntoken" }), id);
      assert.equal(r.source, "db");
      assert.equal(r.token, "EAAowntoken");
    }
  });

  it("operator with nothing anywhere: the same error as before", async () => {
    delete process.env.META_ACCESS_TOKEN;
    await assert.rejects(() => resolveServerMetaToken(tokensDb(null), OPERATOR), (e: Error) => e.message === NO_META_TOKEN_MESSAGE);
  });
});

// ── Every direct read of META_ACCESS_TOKEN is accounted for ────────────────
//
// A new read must either go through agencyMetaToken(caller), or be a system
// path with no caller (cron, a lib helper only reached from operator-gated
// routes, crons or with an explicit token). Adding a file here is a
// deliberate choice.

const ALLOWED_DIRECT_READS = new Set([
  // the guarded helpers
  "lib/meta/agency-token.ts",
  "lib/meta/server-token.ts", // after the mayUseAgencyMetaToken check
  "lib/meta/page-token.ts", // resolvePageIdentity behind allowSystemToken; resolveIgActorForAdAccount (operator-gated callers)
  // crons (CRON_SECRET, no caller)
  "app/api/cron/onsale-refresh/route.ts",
  "app/api/cron/retargeting-read/route.ts", // the Retargeting campaign's daily read, reads only (RT1)
  "app/api/cron/creative-tests-read/route.ts", // the creative tests' daily read: a test ad set's end_time or pause, gated and ledgered (TF6)
  "app/api/cron/optimisation-tick/route.ts",
  "app/api/cron/ad-daily-insights/route.ts",
  "app/api/cron/budget-pacing-check/route.ts",
  // request routes, each checked against the caller first
  "app/api/meta/launch-campaign/route.ts", // 403 for a non-operator with no token, before the read
  "app/api/meta/debug/route.ts", // operator-only
  "app/api/admin/meta-enhancement-probe/route.ts", // CRON_SECRET or operator session (proxy gate)
  // low-level helpers with `token ?? env` defaults, reached only from
  // operator-gated routes, crons, or with a token already resolved
  "lib/meta/client.ts",
  "lib/meta/adset.ts",
  "lib/meta/upload-asset-handler.ts", // handler is operator-only
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("direct META_ACCESS_TOKEN reads", () => {
  it("only happen in the reviewed files", () => {
    const root = process.cwd();
    const readers = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "lib"))]
      .filter((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /process\.env\.META_ACCESS_TOKEN/.test(line)),
      )
      .map((f) => f.slice(root.length + 1));
    const unexpected = readers.filter((f) => !ALLOWED_DIRECT_READS.has(f));
    assert.deepEqual(unexpected, [], `read META_ACCESS_TOKEN through agencyMetaToken(caller) instead: ${unexpected.join(", ")}`);
  });
});
