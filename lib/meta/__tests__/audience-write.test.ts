import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  buildMetaCustomAudiencePayload,
  sanitizeAudienceName,
} from "../audience-payload.ts";
import { resolveAudienceWriteToken } from "../audience-write-token.ts";
import type { MetaCustomAudience } from "../../types/audience.ts";

// ─── resolveAudienceWriteToken (Phase 1 canary) ──────────────────────────────
//
// Phase 1 canary tests for the audience-write token resolver. The
// design lives in `docs/META_TOKEN_ARCHITECTURE_2026-05-11.md` §5.
// We test the resolver directly rather than through
// `createMetaCustomAudience` because the latter pulls
// `getAudienceById` / `updateAudience` from a cookie-bound Supabase
// client which is awkward to mock end-to-end. The resolver is what
// the brief actually asks us to assert: "prefers system user when
// present, falls back to personal when null". The MetaAudiencePost
// stub plumbing for the full createMetaCustomAudience path stays as
// the historical `audience-payload` coverage above.

const ENV_FLAG = "OFFPIXEL_META_SYSTEM_USER_ENABLED";
const ENV_KEY = "META_SYSTEM_TOKEN_KEY";
const ENV_FALLBACK = "META_ACCESS_TOKEN";
const ENV_SUPABASE_URL = "NEXT_PUBLIC_SUPABASE_URL";
const ENV_SUPABASE_SERVICE_ROLE = "SUPABASE_SERVICE_ROLE_KEY";

let originalFlag: string | undefined;
let originalKey: string | undefined;
let originalEnvToken: string | undefined;
let originalSupabaseUrl: string | undefined;
let originalServiceRole: string | undefined;

beforeEach(() => {
  originalFlag = process.env[ENV_FLAG];
  originalKey = process.env[ENV_KEY];
  originalEnvToken = process.env[ENV_FALLBACK];
  originalSupabaseUrl = process.env[ENV_SUPABASE_URL];
  originalServiceRole = process.env[ENV_SUPABASE_SERVICE_ROLE];
});

afterEach(() => {
  restoreEnv(ENV_FLAG, originalFlag);
  restoreEnv(ENV_KEY, originalKey);
  restoreEnv(ENV_FALLBACK, originalEnvToken);
  restoreEnv(ENV_SUPABASE_URL, originalSupabaseUrl);
  restoreEnv(ENV_SUPABASE_SERVICE_ROLE, originalServiceRole);
});

function restoreEnv(name: string, prior: string | undefined) {
  if (prior === undefined) delete process.env[name];
  else process.env[name] = prior;
}

interface FakeClientRow {
  id: string;
  user_id: string;
  meta_ad_account_id: string;
}

interface FakeUserTokenRow {
  user_id: string;
  provider_token: string;
  updated_at: string | null;
  expires_at: string | null;
}

/**
 * Tiny fake matching the subset of `SupabaseClient` that
 * `resolveSystemUserToken` uses when we hand it an injected
 * service-role client: a single `rpc("get_meta_system_user_token", …)`
 * call plus a fire-and-forget `clients.update().eq()` for the
 * last-used-at stamp. The shape mirrors the equivalent fake in
 * `lib/meta/__tests__/system-user-token.test.ts`.
 */
function fakeServiceRoleForSystemUser(
  rpcImpl: (fn: string, args: Record<string, unknown>) => unknown,
) {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      try {
        const data = rpcImpl(fn, args);
        return { data, error: null };
      } catch (err) {
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
    from() {
      return {
        update() {
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof resolveAudienceWriteToken>[2]["injectedServiceRoleClient"];
}

/**
 * Minimal Supabase fake covering the two reads
 * `resolveAudienceWriteToken` performs:
 *
 *   1. `findClientByMetaAdAccountId` →
 *        `clients.select("id, user_id").eq("meta_ad_account_id", …).maybeSingle()`
 *   2. `resolveServerMetaToken` →
 *        `user_facebook_tokens.select(…).eq("user_id", …).maybeSingle()`
 *
 * The resolver also calls into `resolveSystemUserToken`, which uses
 * its own service-role client. We override that with a stub via
 * `installFakeServiceRole` below so the resolver tests stay
 * hermetic.
 */
function fakeSupabase(opts: {
  clientRows?: FakeClientRow[];
  userTokenRows?: FakeUserTokenRow[];
}): Parameters<typeof resolveAudienceWriteToken>[0] {
  return {
    from(table: string) {
      if (table === "clients") {
        return {
          select() {
            return {
              eq(_col: string, val: string) {
                return {
                  limit() {
                    return {
                      maybeSingle() {
                        const row = (opts.clientRows ?? []).find(
                          (r) => r.meta_ad_account_id === val,
                        );
                        return Promise.resolve({
                          data: row ?? null,
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "user_facebook_tokens") {
        return {
          select() {
            return {
              eq(_col: string, val: string) {
                return {
                  maybeSingle() {
                    const row = (opts.userTokenRows ?? []).find(
                      (r) => r.user_id === val,
                    );
                    return Promise.resolve({
                      data: row ?? null,
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as Parameters<typeof resolveAudienceWriteToken>[0];
}

describe("resolveAudienceWriteToken", () => {
  it("prefers the System User token when one is provisioned", async () => {
    process.env[ENV_FLAG] = "true";
    process.env[ENV_KEY] = "x".repeat(32);
    // Personal env fallback set so we'd notice if the resolver
    // accidentally fell all the way through to env=…
    process.env[ENV_FALLBACK] = "ENV-PERSONAL-TOKEN";

    const supabase = fakeSupabase({
      clientRows: [
        {
          id: "client_4tf",
          user_id: "user_matas",
          meta_ad_account_id: "act_4thefans",
        },
      ],
      // Personal token row also populated to prove the resolver
      // doesn't read it when System User is present.
      userTokenRows: [
        {
          user_id: "user_matas",
          provider_token: "PERSONAL-OAUTH-TOKEN",
          updated_at: null,
          expires_at: null,
        },
      ],
    });

    const injectedServiceRoleClient = fakeServiceRoleForSystemUser(
      (fn) => {
        assert.equal(fn, "get_meta_system_user_token");
        return "EAAB-system-user-canary-token";
      },
    );
    const result = await resolveAudienceWriteToken(
      supabase,
      {
        userId: "user_matas",
        metaAdAccountId: "act_4thefans",
        audienceId: "audience_1",
      },
      { injectedServiceRoleClient },
    );
    assert.equal(result.source, "system_user");
    assert.equal(result.token, "EAAB-system-user-canary-token");
  });

  it("falls back to the personal OAuth token when no System User is provisioned", async () => {
    process.env[ENV_FLAG] = "true";
    process.env[ENV_KEY] = "x".repeat(32);
    delete process.env[ENV_FALLBACK];

    const supabase = fakeSupabase({
      clientRows: [
        {
          id: "client_no_su",
          user_id: "user_matas",
          meta_ad_account_id: "act_legacy",
        },
      ],
      userTokenRows: [
        {
          user_id: "user_matas",
          provider_token: "PERSONAL-OAUTH-TOKEN",
          updated_at: null,
          expires_at: null,
        },
      ],
    });

    // Service-role RPC returns null → resolver returns null →
    // resolver falls back to resolveServerMetaToken (db).
    const injectedServiceRoleClient = fakeServiceRoleForSystemUser(
      () => null,
    );
    const result = await resolveAudienceWriteToken(
      supabase,
      {
        userId: "user_matas",
        metaAdAccountId: "act_legacy",
        audienceId: "audience_2",
      },
      { injectedServiceRoleClient },
    );
    assert.equal(result.source, "db");
    assert.equal(result.token, "PERSONAL-OAUTH-TOKEN");
  });

  it("falls back when the ad account has no owning client row", async () => {
    process.env[ENV_FLAG] = "true";
    process.env[ENV_KEY] = "x".repeat(32);
    delete process.env[ENV_FALLBACK];

    const supabase = fakeSupabase({
      clientRows: [],
      userTokenRows: [
        {
          user_id: "user_matas",
          provider_token: "PERSONAL-OAUTH-TOKEN",
          updated_at: null,
          expires_at: null,
        },
      ],
    });

    // injectedServiceRoleClient should NEVER fire because the
    // client lookup returns null first. We point it at a throwing
    // implementation as a tripwire.
    const injectedServiceRoleClient = fakeServiceRoleForSystemUser(() => {
      throw new Error(
        "system-user RPC must not run when no client row matches",
      );
    });
    const result = await resolveAudienceWriteToken(
      supabase,
      {
        userId: "user_matas",
        metaAdAccountId: "act_orphan",
        audienceId: "audience_3",
      },
      { injectedServiceRoleClient },
    );
    assert.equal(result.source, "db");
    assert.equal(result.token, "PERSONAL-OAUTH-TOKEN");
  });
});

/**
 * Rule shapes verified 2026-05-07 via Graph API Explorer vs reference audiences in
 * act_10151014958791885. ROOT CAUSE of historical #2654 failures (PRs #313–#337):
 * Meta deprecated `subtype` for engagement audiences Sep 2018 — including it triggers
 * #2654. Cross-verified from lib/meta/client.ts createEngagementAudience() which sends
 * ONLY {name, rule, prefill} and has always worked.
 *
 * Structural notes:
 *   - Engagement: NO `subtype`, NO `retention_days` top-level; event_sources.id is a STRING
 *   - Video views: top-level `retention_days` required (bare-array rule has no retention)
 *   - Pixel: NO top-level `retention_days` — retention is rule.retention_seconds
 *   - Pixel URL rules: VISITORS_BY_URL OR-group + trailing empty url filter
 */
describe("sanitizeAudienceName", () => {
  it("maps UI-style name with brackets and spaces to underscores for Meta POST", () => {
    assert.equal(
      sanitizeAudienceName("[4thefans] FB page engagement 30d"),
      "4thefans_FB_page_engagement_30d",
    );
  });

  it("maps slashes to underscores", () => {
    assert.equal(sanitizeAudienceName("Off/Pixel Test"), "Off_Pixel_Test");
  });

  it("truncates to Meta 50-char limit", () => {
    assert.equal(sanitizeAudienceName("a".repeat(60)).length, 50);
    assert.equal(sanitizeAudienceName("a".repeat(60)), "a".repeat(50));
  });

  it("collapses consecutive separators to a single underscore", () => {
    assert.equal(sanitizeAudienceName("a   b"), "a_b");
  });
});

describe("buildMetaCustomAudiencePayload", () => {
  // ─── FB page engagement ─────────────────────────────────────────────────────

  it("single-page FB engagement: NO subtype, NO retention_days; rule + event_sources.id as string", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_fb",
        retentionDays: 365,
        sourceId: "202868440480679",
        sourceMeta: { subtype: "page_engagement_fb", pageName: "4theFans" },
      }),
    );
    // Engagement audiences must NOT send subtype or retention_days (deprecated Sep 2018).
    assert.ok(!("subtype" in payload), "engagement payload must not include subtype");
    assert.ok(!("retention_days" in payload), "engagement payload must not include retention_days");
    assert.ok(payload.rule);
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules.length, 1);
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "page");
    // event_sources.id sent as string, not coerced to number.
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "202868440480679");
    assert.equal(typeof rule.inclusions.rules[0].event_sources[0].id, "string");
    assert.equal(rule.inclusions.rules[0].retention_seconds, 365 * 86_400);
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.field, "event");
    assert.equal(ev.operator, "eq");
    assert.equal(ev.value, "page_engaged");
  });

  it("sanitized name appears on payload.name for Meta POST validation", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        name: "[4thefans] FB page engagement 30d",
        audienceSubtype: "page_engagement_fb",
        retentionDays: 30,
        sourceId: "202868440480679",
        sourceMeta: { subtype: "page_engagement_fb", pageName: "4theFans" },
      }),
    );
    assert.equal(payload.name, "4thefans_FB_page_engagement_30d");
  });

  it("multi-page FB engagement: NO subtype, NO retention_days; string ids", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_fb",
        retentionDays: 365,
        sourceId: "100000001,100000002",
        sourceMeta: {
          subtype: "page_engagement_fb",
          pageIds: ["100000001", "100000002"],
          pageName: "Primary",
        },
      }),
    );
    assert.ok(!("subtype" in payload));
    assert.ok(!("retention_days" in payload));
    assert.ok(payload.rule);
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules.length, 2);
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "100000001");
    assert.equal(rule.inclusions.rules[1].event_sources[0].id, "100000002");
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.value, "page_engaged");
  });

  // ─── IG page engagement ─────────────────────────────────────────────────────

  it("single-page IG engagement: NO subtype; ig_business, string id, event=ig_business_profile_all", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_ig",
        retentionDays: 365,
        sourceId: "100000003",
        sourceMeta: { subtype: "page_engagement_ig", pageName: "4thefansevents" },
      }),
    );
    assert.ok(!("subtype" in payload));
    assert.ok(!("retention_days" in payload));
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "ig_business");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "100000003");
    assert.equal(typeof rule.inclusions.rules[0].event_sources[0].id, "string");
    assert.equal(rule.inclusions.rules[0].retention_seconds, 365 * 86_400);
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.value, "ig_business_profile_all");
  });

  it("multi-page IG engagement: two ig_business entries, string ids, event=ig_business_profile_all", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_ig",
        retentionDays: 365,
        sourceId: "200000001,200000002",
        sourceMeta: {
          subtype: "page_engagement_ig",
          pageIds: ["200000001", "200000002"],
          pageName: "Junction 2",
        },
      }),
    );
    assert.ok(!("subtype" in payload));
    assert.ok(!("retention_days" in payload));
    assert.ok(payload.rule);
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules.length, 2);
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "ig_business");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "200000001");
    assert.equal(rule.inclusions.rules[1].event_sources[0].type, "ig_business");
    assert.equal(rule.inclusions.rules[1].event_sources[0].id, "200000002");
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.value, "ig_business_profile_all");
  });

  // ─── FB page followers ──────────────────────────────────────────────────────

  it("single-page FB followers: NO subtype, NO retention_days; event=page_liked; string id", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_followers_fb",
        retentionDays: 365,
        sourceId: "202868440480679",
        sourceMeta: { subtype: "page_followers_fb", pageName: "4theFans" },
      }),
    );
    assert.ok(!("subtype" in payload));
    assert.ok(!("retention_days" in payload));
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "page");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "202868440480679");
    assert.equal(rule.inclusions.rules[0].retention_seconds, 0);
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.value, "page_liked");
  });

  // ─── IG followers ───────────────────────────────────────────────────────────

  it("single-page IG followers: NO subtype; ig_business, string id, event=INSTAGRAM_PROFILE_FOLLOW", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_followers_ig",
        retentionDays: 365,
        sourceId: "100000004",
        sourceMeta: { subtype: "page_followers_ig", pageName: "4theFans" },
      }),
    );
    assert.ok(!("subtype" in payload));
    assert.ok(!("retention_days" in payload));
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "ig_business");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "100000004");
    assert.equal(rule.inclusions.rules[0].retention_seconds, 0);
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.value, "INSTAGRAM_PROFILE_FOLLOW");
  });

  // ─── Video views ─────────────────────────────────────────────────────────────
  // Rule is a BARE JSON ARRAY (not {inclusions:{...}}).
  // Verified 2026-05-07 from audience 6984471975065.

  it("video views 95%: bare array, subtype=ENGAGEMENT, event_name=video_completed", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1,v2,v3",
        sourceMeta: {
          subtype: "video_views",
          threshold: 95,
          campaignId: "camp_1",
          campaignName: "[4TF26] Promo",
          videoIds: ["v1", "v2", "v3"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(payload.retention_days, "30");
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.notEqual(payload.subtype, "VIDEO");
    assert.notEqual(payload.subtype, "VIDEO_VIEWERS_VIEWED");
    assert.ok(Array.isArray(ruleArray), "rule must be a bare JSON array, not {inclusions:{...}}");
    assert.equal(ruleArray.length, 3);
    assert.equal(ruleArray[0].event_name, "video_completed");
    assert.notEqual(ruleArray[0].event_name, "video_watched_95_percent");
    assert.equal(ruleArray[0].object_id, "v1");
    assert.equal(ruleArray[0].context_id, "page_ctx_1");
    assert.equal(ruleArray[1].object_id, "v2");
    assert.equal(ruleArray[2].object_id, "v3");
    assert.equal(ruleArray[2].event_name, "video_completed");
  });

  it("video views: retention_days matches audience.retentionDays (string)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 90,
        sourceId: "v1",
        sourceMeta: {
          subtype: "video_views",
          threshold: 25,
          videoIds: ["v1"],
          contextId: "page_ctx_1",
        },
      }),
    );
    assert.equal(payload.retention_days, "90");
  });

  it("video views 50%: event_name=video_view_50_percent (not video_watched_50_percent)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1",
        sourceMeta: {
          subtype: "video_views",
          threshold: 50,
          videoIds: ["v1"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(ruleArray[0].event_name, "video_view_50_percent");
    assert.notEqual(ruleArray[0].event_name, "video_watched_50_percent");
  });

  it("video views 100%: event_name=video_completed (same as 95%)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1",
        sourceMeta: {
          subtype: "video_views",
          threshold: 100,
          videoIds: ["v1"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(ruleArray[0].event_name, "video_completed");
  });

  it("video views 75%: event_name=video_view_75_percent", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1",
        sourceMeta: {
          subtype: "video_views",
          threshold: 75,
          videoIds: ["v1"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(ruleArray[0].event_name, "video_view_75_percent");
  });

  it("video views throws when contextId is absent", () => {
    assert.throws(
      () =>
        buildMetaCustomAudiencePayload(
          audience({
            audienceSubtype: "video_views",
            retentionDays: 30,
            sourceId: "v1",
            sourceMeta: {
              subtype: "video_views",
              threshold: 95,
              videoIds: ["v1"],
            },
          }),
        ),
      /contextId/,
    );
  });

  // ─── Website pixel ──────────────────────────────────────────────────────────
  // Verified 2026-05-07 from audience 6983230099865 ("Arsenal CL Final Pixel"):
  //   - event_sources.id is a JSON number
  //   - URL filter: VISITORS_BY_URL OR-group + TRAILING {field:url,i_contains,""} 
  //   - Without the trailing empty filter Meta rejects with #2654 subcode 1870053
  //   - URL scheme (https://) is preserved — Meta stores it as-is
  //   - No URL → event-only leaf, length 1 (no trailing empty)
  //   - No `subtype` field — same lesson as engagement (PR #340); Meta deprecated
  //     it and including "WEBSITE" triggers #2654 subcode 1870053

  it("website pixel with URL: NO subtype; numeric sourceId, OR-group + trailing empty filter, scheme preserved", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
          urlContains: "https://wearefootballfestival.co.uk",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.ok(!("subtype" in payload), "pixel payload must not include subtype");
    assert.ok(
      !("retention_days" in payload),
      "pixel omits top-level retention_days (uses rule.retention_seconds)",
    );
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "pixel");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, 6983230099865);
    assert.equal(typeof rule.inclusions.rules[0].event_sources[0].id, "number");
    assert.equal(typeof rule.inclusions.rules[0].retention_seconds, "number");
    assert.equal(rule.inclusions.rules[0].filter.operator, "and");
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 2, "OR-group + trailing empty filter");
    const urlGroup = filters[0] as UrlOrGroupWithTemplate;
    assert.equal(urlGroup.operator, "or");
    assert.equal(urlGroup.template, "VISITORS_BY_URL");
    assert.equal(urlGroup.filters.length, 1);
    assert.equal(urlGroup.filters[0].value, "https://wearefootballfestival.co.uk");
    assert.equal(urlGroup.filters[0].field, "url");
    const trailing = filters[1] as EventLeaf;
    assert.equal(trailing.field, "url");
    assert.equal(trailing.operator, "i_contains");
    assert.equal(trailing.value, "");
  });

  it("website pixel multi-URL: OR group + trailing empty, values unchanged", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "ViewContent",
          urlContains: ["/arsenal-cl-final", "/arsenal-cl-presale", "/extra"],
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 2);
    const urlGroup = filters[0] as UrlOrGroupWithTemplate;
    assert.equal(urlGroup.operator, "or");
    assert.equal(urlGroup.template, "VISITORS_BY_URL");
    assert.equal(urlGroup.filters.length, 3);
    assert.deepEqual(
      urlGroup.filters.map((f) => f.value),
      ["/arsenal-cl-final", "/arsenal-cl-presale", "/extra"],
    );
    const trailing = filters[1] as EventLeaf;
    assert.equal(trailing.field, "url");
    assert.equal(trailing.value, "");
  });

  it("website pixel https:// is NOT stripped from URL values (Meta stores scheme)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
          urlContains: [
            "https://wearefootballfestival.co.uk/final",
            "http://example.org/presale",
          ],
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const urlGroup = rule.inclusions.rules[0].filter.filters[0] as UrlOrGroupWithTemplate;
    assert.deepEqual(
      urlGroup.filters.map((f) => f.value),
      ["https://wearefootballfestival.co.uk/final", "http://example.org/presale"],
    );
  });

  it("website pixel with no URL: single event-only leaf, no trailing empty, operator=eq", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 1, "no trailing empty when no URL filter");
    const only = filters[0] as EventLeaf;
    assert.equal(only.field, "event");
    assert.equal(only.operator, "eq");
    assert.equal(only.value, "PageView");
  });
});

// ─── Types ────────────────────────────────────────────────────────────────────

type EventLeaf = { field: string; operator: string; value: string };

type UrlOrGroupWithTemplate = {
  operator: "or";
  template?: string;
  filters: Array<{ field: string; operator: string; value: string }>;
};

type VideoRuleEntry = {
  event_name: string;
  object_id: string;
  context_id: string;
};

interface EngagementRuleShape {
  inclusions: {
    rules: Array<{
      event_sources: Array<{ type: string; id: number | string }>;
      retention_seconds: number;
      filter: {
        operator: string;
        filters: Array<
          | { field: string; operator?: string; value: string }
          | UrlOrGroupWithTemplate
        >;
      };
    }>;
  };
}

function audience(patch: Partial<MetaCustomAudience>): MetaCustomAudience {
  return {
    id: "audience_1",
    userId: "user_1",
    clientId: "client_1",
    eventId: null,
    name: "[EVT] Audience 365d",
    funnelStage: "top_of_funnel",
    audienceSubtype: "page_engagement_fb",
    retentionDays: 365,
    sourceId: "source_1",
    sourceMeta: { subtype: "page_engagement_fb" },
    metaAudienceId: null,
    metaAdAccountId: "act_123",
    status: "draft",
    statusError: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...patch,
  };
}
