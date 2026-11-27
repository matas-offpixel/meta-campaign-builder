import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildMetaCustomAudiencePayload } from "../audience-payload.ts";
import {
  META_CUSTOM_AUDIENCE_LIST_FIELDS,
  findAudiencesByName,
  listAccountCustomAudiences,
  matchAudienceByName,
  resolveByShowName,
  reuseOrCreateCustomAudience,
  type ListedMetaCustomAudience,
  type MetaGraphFetch,
} from "../reuse-existing-audience.ts";
import type { MetaCustomAudience } from "../../types/audience.ts";

const AHMED_IG = "17841400034415031";
const AHMED_FIRST = "120249428134610453";
const AHMED_SECOND = "120249955627300453";
const TOKEN = "TEST_TOKEN_DO_NOT_LOG";

describe("reuse an existing custom audience", () => {
  it("returns the first id of a same-rule pair and does not POST", async () => {
    const payload = buildMetaCustomAudiencePayload(followers());
    const stored = payload.rule.replaceAll(`"id":"${AHMED_IG}"`, `"id":${AHMED_IG}`);
    assert.notEqual(stored, payload.rule);
    const posts: string[] = [];
    const existing = await listed(accountList([
      { id: "decoy-name-only", name: "Ahmed Spins IG Followers", subtype: "IG_BUSINESS", rule: otherPageRule(stored) },
      { id: AHMED_FIRST, name: "Ahmed Spins IG Followers", subtype: "IG_BUSINESS", rule: stored },
      { id: AHMED_SECOND, name: "Ahmed Spins IG Followers", subtype: "IG_BUSINESS", rule: stored },
    ]));

    const result = await reuseOrCreateCustomAudience({
      payload,
      existing,
      create: async () => {
        posts.push("post");
        return "created-id";
      },
    });

    assert.equal(posts.length, 0);
    assert.equal(result.reused, true);
    assert.equal(result.metaAudienceId, AHMED_FIRST);
  });

  it("creates when the rule differs only by retention", async () => {
    const stored = buildMetaCustomAudiencePayload(engagement(365));
    const payload = buildMetaCustomAudiencePayload(engagement(180));
    assert.notEqual(payload.rule, stored.rule);
    const posts: string[] = [];
    const result = await reuseOrCreateCustomAudience({
      payload,
      existing: [
        {
          id: AHMED_FIRST,
          name: "Deep House Bible IG Engagement 365d",
          subtype: "IG_BUSINESS",
          rule: stored.rule,
        },
      ],
      create: async () => {
        posts.push("post");
        return "created-id";
      },
    });
    assert.equal(posts.length, 1);
    assert.equal(result.reused, false);
    assert.equal(result.metaAudienceId, "created-id");
  });

  it("matches a rule whose JSON keys are in a different order", async () => {
    const payload = buildMetaCustomAudiencePayload(engagement(365));
    const parsed = JSON.parse(payload.rule) as unknown;
    const shuffled = shuffleKeys(parsed);
    assert.notEqual(JSON.stringify(parsed), JSON.stringify(shuffled));
    const posts: string[] = [];
    const result = await reuseOrCreateCustomAudience({
      payload,
      existing: [
        {
          id: AHMED_SECOND,
          name: "some other name",
          subtype: "IG_BUSINESS",
          rule: shuffled,
        },
      ],
      create: async () => {
        posts.push("post");
        return "created-id";
      },
    });
    assert.equal(posts.length, 0);
    assert.equal(result.reused, true);
    assert.equal(result.metaAudienceId, AHMED_SECOND);
  });

  it("does not reuse a payload with neither rule nor lookalike_spec", async () => {
    const posts: string[] = [];
    const result = await reuseOrCreateCustomAudience({
      payload: {
        name: "Buyers",
        subtype: "CUSTOM",
        customer_file_source: "USER_PROVIDED_ONLY",
      },
      existing: [
        {
          id: AHMED_FIRST,
          name: "Buyers",
          subtype: "CUSTOM",
        },
      ],
      create: async () => {
        posts.push("post");
        return "created-id";
      },
    });
    assert.equal(posts.length, 1);
    assert.equal(result.reused, false);
    assert.equal(result.metaAudienceId, "created-id");
  });

  it("reuses a lookalike with the same origin and spec, and creates when the ratio differs", async () => {
    const payload = buildMetaCustomAudiencePayload(lookalike(0.01));
    const spec = JSON.parse(payload.lookalike_spec) as Record<string, unknown>;
    const shuffledSpec = {
      origin: [{ id: "120249428134610453", type: "custom_audience", name: "Ahmed Spins IG Followers" }],
      ...shuffleKeys(spec) as Record<string, unknown>,
    };
    const posts: string[] = [];
    const same = await reuseOrCreateCustomAudience({
      payload,
      existing: [
        {
          id: "not-a-lookalike",
          name: payload.name,
          subtype: "ENGAGEMENT",
          lookalike_spec: spec,
          origin_audience_id: "120249428134610453",
        },
        {
          id: "120200000000000001",
          name: "different name",
          subtype: "LOOKALIKE",
          lookalike_spec: shuffledSpec,
        },
      ],
      create: async () => {
        posts.push("post");
        return "created-id";
      },
    });
    assert.equal(posts.length, 0);
    assert.equal(same.reused, true);
    assert.equal(same.metaAudienceId, "120200000000000001");

    const wider = buildMetaCustomAudiencePayload(lookalike(0.03));
    const created = await reuseOrCreateCustomAudience({
      payload: wider,
      existing: [
        {
          id: "120200000000000001",
          name: "lal",
          subtype: "LOOKALIKE",
          lookalike_spec: shuffledSpec,
        },
      ],
      create: async () => {
        posts.push("post");
        return "created-wider";
      },
    });
    assert.equal(posts.length, 1);
    assert.equal(created.reused, false);
    assert.equal(created.metaAudienceId, "created-wider");
  });
});

describe("list read", () => {
  it("requests rule and lookalike_spec and does not log the access token", async () => {
    const urls: string[] = [];
    const logs: string[] = [];
    const fetchImpl: MetaGraphFetch = async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      };
    };
    const orig = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await listAccountCustomAudiences("act_10151014958791885", TOKEN, fetchImpl);
    } finally {
      console.log = orig;
      console.warn = origWarn;
      console.error = origError;
    }
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /fields=[^&]*rule/);
    assert.match(urls[0]!, /lookalike_spec/);
    // The reuse lookup asks only what matching reads, 50 a page (27 Nov: the full list made Meta ask for less data).
    assert.doesNotMatch(urls[0]!, /approximate_count_lower_bound/);
    assert.match(urls[0]!, /limit=50/);
    assert.doesNotMatch(urls[0]!, /approximate_count_upper_bound/);
    assert.equal(logs.some((line) => line.includes(TOKEN)), false);
  });
});

describe("create result and builder row", () => {
  it("reports reused on a hit and the builder result row renders reused", () => {
    const write = readFileSync("lib/meta/audience-write.ts", "utf8");
    const start = write.indexOf("export async function createMetaCustomAudience");
    const end = write.indexOf("async function prefilterPageEngagementAccess");
    const body = write.slice(start, end);
    const assertAt = body.indexOf("assertMetaAudienceWritesEnabled()");
    const reuseAt = body.indexOf("reuseOrCreateCustomAudience");
    const splitAt = body.indexOf("writeSplitPageEngagement");
    assert.ok(assertAt > 0 && assertAt < reuseAt && reuseAt < splitAt);
    assert.match(body, /reused: true/);
    assert.doesNotMatch(body, /createOneMetaAudience/);
    assert.doesNotMatch(body, /withMetaAudienceWriteIdempotency/);

    const route = readFileSync("app/api/audiences/[id]/write/route.ts", "utf8");
    assert.match(route, /\{ ok: true, audience \}/);

    const fieldsRoute = readFileSync("app/api/meta/custom-audiences/route.ts", "utf8");
    assert.match(fieldsRoute, /META_CUSTOM_AUDIENCE_LIST_FIELDS/);
    assert.match(META_CUSTOM_AUDIENCE_LIST_FIELDS, /(^|,)rule(,|$)/);
    assert.match(META_CUSTOM_AUDIENCE_LIST_FIELDS, /lookalike_spec/);
    assert.match(META_CUSTOM_AUDIENCE_LIST_FIELDS, /approximate_count_lower_bound/);
    assert.match(META_CUSTOM_AUDIENCE_LIST_FIELDS, /approximate_count_upper_bound/);

    for (const [file, fn] of [
      ["app/(dashboard)/audiences/[clientId]/bulk/bulk-form.tsx", "AudienceResultRow"],
      ["app/(dashboard)/audiences/[clientId]/bulk-website/bulk-website-form.tsx", "CellResultRow"],
      ["app/(dashboard)/audiences/[clientId]/bulk-page/bulk-page-form.tsx", "CellResultRow"],
      ["app/(dashboard)/audiences/[clientId]/lookalike/lookalike-form.tsx", "CellResultRow"],
    ] as const) {
      const src = readFileSync(file, "utf8");
      const at = src.indexOf(`function ${fn}`);
      assert.ok(at >= 0, `${fn} in ${file}`);
      assert.match(src.slice(at, at + 800), /· reused/);
    }
  });
});

function followers(): MetaCustomAudience {
  return audience({
    name: "Ahmed Spins IG Followers",
    audienceSubtype: "page_followers_ig",
    retentionDays: 365,
    sourceId: AHMED_IG,
    sourceMeta: { subtype: "page_followers_ig", pageIds: [AHMED_IG] },
  });
}

function engagement(retentionDays: number): MetaCustomAudience {
  return audience({
    name: "Deep House Bible IG Engagement 365d",
    audienceSubtype: "page_engagement_ig",
    retentionDays,
    sourceId: AHMED_IG,
    sourceMeta: { subtype: "page_engagement_ig", pageIds: [AHMED_IG] },
  });
}

function lookalike(ratio: number): MetaCustomAudience {
  return audience({
    name: "Ahmed Spins LAL 1 GB",
    audienceSubtype: "lookalike",
    retentionDays: 1,
    sourceId: AHMED_FIRST,
    sourceMeta: {
      subtype: "lookalike",
      originAudienceId: AHMED_FIRST,
      ratio,
      country: "GB",
      seedName: "Ahmed Spins IG Followers",
      type: "similarity",
    },
  });
}

function audience(patch: Partial<MetaCustomAudience>): MetaCustomAudience {
  return {
    id: "audience_1",
    userId: "user_1",
    clientId: "client_1",
    eventId: null,
    name: "Audience",
    funnelStage: "top_of_funnel",
    audienceSubtype: "page_engagement_ig",
    retentionDays: 365,
    sourceId: AHMED_IG,
    sourceMeta: { subtype: "page_engagement_ig", pageIds: [AHMED_IG] },
    metaAudienceId: null,
    metaAdAccountId: "act_1",
    status: "draft",
    statusError: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...patch,
  };
}

function otherPageRule(rule: string): string {
  return rule.replaceAll(AHMED_IG, "17841414606202049");
}

function shuffleKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).reverse()) {
      out[key] = shuffleKeys(nested);
    }
    return out;
  }
  return value;
}

async function listed(rows: ListedMetaCustomAudience[]): Promise<ListedMetaCustomAudience[]> {
  const fetchImpl: MetaGraphFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: rows }),
  });
  return listAccountCustomAudiences("10151014958791885", TOKEN, fetchImpl);
}

function accountList(rows: ListedMetaCustomAudience[]): ListedMetaCustomAudience[] {
  return rows;
}

describe("the reuse lookup on a large account (NX26-RUDIMENTAL, 27 Nov)", () => {
  it("Meta asks for less data: the same page again at half the limit, cursor kept, then paged to the end", async () => {
    const urls: string[] = [];
    const fetchImpl: MetaGraphFetch = async (url) => {
      urls.push(url);
      const u = new URL(url);
      const limit = Number(u.searchParams.get("limit"));
      if (limit > 20) return { ok: false, status: 500, json: async () => ({ error: { message: "Please reduce the amount of data you're asking for, then retry your request", code: 1 } }) };
      if (!u.searchParams.get("after")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "a1" }], paging: { next: `https://graph.facebook.com/v21.0/act_1/customaudiences?access_token=${TOKEN}&limit=200&after=CUR1` } }) };
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "a2" }] }) };
    };
    const rows = await listAccountCustomAudiences("act_1", TOKEN, fetchImpl);
    assert.deepEqual(rows.map((row) => row.id), ["a1", "a2"]);
    assert.deepEqual(urls.map((url) => new URL(url).searchParams.get("limit")), ["50", "25", "12", "12"]);
    assert.equal(new URL(urls[3]!).searchParams.get("after"), "CUR1");
  });

  it("still refused at the floor: the lookup throws (the caller decides whether to create blind)", async () => {
    const fetchImpl: MetaGraphFetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "Please reduce the amount of data you're asking for, then retry your request" } }) });
    await assert.rejects(() => listAccountCustomAudiences("act_1", TOKEN, fetchImpl), /reduce the amount of data/);
  });
});

describe("the retargeting build's name lookup (27 Nov, after #1412)", () => {
  it("asks for the show's code in the name and id,name,subtype only: no rule, no lookalike_spec", async () => {
    const urls: string[] = [];
    const fetchImpl: MetaGraphFetch = async (url) => (urls.push(url), { ok: true, status: 200, json: async () => ({ data: [{ id: "1", name: "NX26_RUDIMENTAL_Page_followers_all_time", subtype: "ENGAGEMENT" }] }) });
    const rows = await findAudiencesByName("606252931141334", TOKEN, "NX26_RUDIMENTAL", fetchImpl, { timeoutMs: 8000 });
    assert.equal(rows.length, 1);
    const u = new URL(urls[0]!);
    assert.equal(u.pathname.endsWith("/act_606252931141334/customaudiences"), true);
    assert.equal(u.searchParams.get("fields"), "id,name,subtype");
    assert.deepEqual(JSON.parse(u.searchParams.get("filtering")!), [{ field: "name", operator: "CONTAIN", value: "NX26_RUDIMENTAL" }]);
  });

  it("gives up at its limit (a slow Meta never holds the build)", async () => {
    // AbortSignal.timeout's timer is unref'd: a ref'd one keeps the event loop alive while the fake waits on the abort.
    const keepAlive = setTimeout(() => undefined, 5_000);
    try {
      const fetchImpl: MetaGraphFetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      const started = Date.now();
      await assert.rejects(() => findAudiencesByName("act_1", TOKEN, "NX26_RUDIMENTAL", fetchImpl, { timeoutMs: 50 }), /aborted/);
      assert.ok(Date.now() - started < 2000);
    } finally {
      clearTimeout(keepAlive);
    }
  });

  it("matches the exact name only, and never a name Meta may have cut at 50", () => {
    const listed = [{ id: "a", name: "NX26_RUDIMENTAL_Page_followers_all_time" }, { id: "b", name: "X".repeat(50) }];
    assert.equal(matchAudienceByName("NX26_RUDIMENTAL_Page_followers_all_time", listed)?.id, "a");
    assert.equal(matchAudienceByName("NX26_RUDIMENTAL_Page_followers", listed), null);
    assert.equal(matchAudienceByName("X".repeat(50), listed), null);
  });

  it("a failed read is none found only for the app's own name for the show; anything else is unsure", async () => {
    const read = async () => {
      throw new Error("Please reduce the amount of data you're asking for, then retry your request");
    };
    assert.deepEqual(await resolveByShowName({ name: "NX26_RUDIMENTAL_Page_followers_all_time", code: "NX26_RUDIMENTAL", read }), { id: null });
    const other = await resolveByShowName({ name: "Rudimental_followers", code: "NX26_RUDIMENTAL", read });
    assert.ok("unsure" in other);
    assert.deepEqual(await resolveByShowName({ name: "NX26_RUDIMENTAL_Visitors_60_days", code: "NX26_RUDIMENTAL", read: async () => [{ id: "9", name: "NX26_RUDIMENTAL_Visitors_60_days" }] }), { id: "9" });
  });
});
