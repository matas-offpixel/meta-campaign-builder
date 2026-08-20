import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractBcIdsFromList,
  extractIdentityBcId,
  fetchAdvertiserBusinessCenterId,
  fetchTikTokIdentities,
} from "../identity.ts";

/** Exact /identity/get/ row keys logged for advertiser 7639802149165301776. */
const PRODUCTION_IDENTITY_ROW = {
  ads_only_mode: false,
  available_status: true,
  can_manage_message: true,
  can_pull_video: true,
  can_push_video: true,
  can_use_live_ads: true,
  display_name: "Ironworks",
  identity_authorized_bc_id: "7078123456789012345",
  identity_id: "ironworks-id",
  identity_type: "BC_AUTH_TT",
  is_gpppa: false,
  profile_image: "https://example.com/ironworks.jpg",
  username: "ironworks",
} as const;

describe("fetchTikTokIdentities", () => {
  it("parses an unfiltered /identity/get/ response under list", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        calls.push(params);
        return {
          list: [
            {
              identity_id: "id-list",
              display_name: "From list",
              identity_type: "BC_AUTH_TT",
              identity_bc_id: "bc-from-row",
            },
          ],
        } as T;
      },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { advertiser_id: "advertiser-1" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity_id, "id-list");
    assert.equal(rows[0].identity_type, "BC_AUTH_TT");
    assert.equal(rows[0].identity_bc_id, "bc-from-row");
  });

  it("parses an unfiltered /identity/get/ response under identity_list", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        calls.push(params);
        return {
          identity_list: [
            {
              identity_id: "id-alt",
              display_name: "From identity_list",
              identity_type: "TT_USER",
            },
          ],
        } as T;
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity_id, "id-alt");
    assert.equal(rows[0].display_name, "From identity_list");
  });

  it("falls back to per-type calls when the unfiltered response is empty", async () => {
    const identityTypes: Array<string | undefined> = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        identityTypes.push(
          typeof params.identity_type === "string"
            ? params.identity_type
            : undefined,
        );
        if (!params.identity_type) return { list: [] } as T;
        return {
          list: [
            {
              identity_id: `identity-${params.identity_type}`,
              display_name: `Identity ${params.identity_type}`,
              identity_bc_id:
                params.identity_type === "BC_AUTH_TT" ? "bc-ladder" : undefined,
            },
          ],
        } as T;
      },
    });

    assert.deepEqual(identityTypes, [
      undefined,
      "BC_AUTH_TT",
      "AUTH_CODE",
      "CUSTOMIZED_USER",
      "TT_USER",
    ]);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].identity_type, "AUTH_CODE");
    assert.equal(rows[0].display_name, "Identity AUTH_CODE");
  });

  it("continues remaining per-type calls when the first type throws", async () => {
    const identityTypes: Array<string | undefined> = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        identityTypes.push(
          typeof params.identity_type === "string"
            ? params.identity_type
            : undefined,
        );
        if (!params.identity_type) return { list: [] } as T;
        if (params.identity_type === "BC_AUTH_TT") {
          throw new Error("BC_AUTH_TT missing authorized bc id");
        }
        return {
          list: [
            {
              identity_id: `identity-${params.identity_type}`,
              display_name: `Identity ${params.identity_type}`,
            },
          ],
        } as T;
      },
    });

    assert.deepEqual(identityTypes, [
      undefined,
      "BC_AUTH_TT",
      "AUTH_CODE",
      "CUSTOMIZED_USER",
      "TT_USER",
    ]);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.identity_type !== "BC_AUTH_TT"));
    assert.deepEqual(
      rows.map((row) => row.identity_type).sort(),
      ["AUTH_CODE", "CUSTOMIZED_USER", "TT_USER"],
    );
  });

  it("uses identity_type from the row, not the request filter", async () => {
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>() =>
        ({
          list: [
            {
              identity_id: "shared-bc",
              display_name: "Ironworks",
              identity_type: "BC_AUTH_TT",
              identity_bc_id: "bc-ironworks",
            },
          ],
        }) as T,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity_type, "BC_AUTH_TT");
  });

  it("falls back to per-type calls when the unfiltered call throws", async () => {
    const identityTypes: Array<string | undefined> = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        identityTypes.push(
          typeof params.identity_type === "string"
            ? params.identity_type
            : undefined,
        );
        if (!params.identity_type) {
          throw new Error("code 50001 rate limit");
        }
        return {
          list: [
            {
              identity_id: `identity-${params.identity_type}`,
              display_name: `Identity ${params.identity_type}`,
              identity_bc_id:
                params.identity_type === "BC_AUTH_TT" ? "bc-ladder" : undefined,
            },
          ],
        } as T;
      },
    });

    assert.deepEqual(identityTypes, [
      undefined,
      "BC_AUTH_TT",
      "AUTH_CODE",
      "CUSTOMIZED_USER",
      "TT_USER",
    ]);
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((row) => row.identity_type).sort(),
      ["AUTH_CODE", "BC_AUTH_TT", "CUSTOMIZED_USER", "TT_USER"],
    );
  });

  it("fills a missing identity_type from the per-type filter, not TT_USER", async () => {
    const identityTypes: Array<string | undefined> = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        identityTypes.push(
          typeof params.identity_type === "string"
            ? params.identity_type
            : undefined,
        );
        if (!params.identity_type) {
          return {
            list: [
              {
                identity_id: "shared-bc",
                display_name: "Ironworks",
              },
            ],
          } as T;
        }
        if (params.identity_type === "BC_AUTH_TT") {
          return {
            list: [
              {
                identity_id: "shared-bc",
                display_name: "Ironworks",
                identity_bc_id: "bc-ironworks",
              },
            ],
          } as T;
        }
        return { list: [] } as T;
      },
    });

    assert.ok(identityTypes.length > 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity_id, "shared-bc");
    assert.equal(rows[0].identity_type, "BC_AUTH_TT");
    assert.notEqual(rows[0].identity_type, "TT_USER");
  });

  it("returns identity_type null when neither pass observes a type", async () => {
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        if (!params.identity_type) {
          return {
            list: [
              {
                identity_id: "untyped-id",
                display_name: "Untyped identity",
              },
            ],
          } as T;
        }
        return { list: [] } as T;
      },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity_id, "untyped-id");
    assert.equal(rows[0].identity_type, null);
  });

  it("does not run the per-type ladder when unfiltered rows already carry identity_type", async () => {
    const identityTypes: Array<string | undefined> = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        identityTypes.push(
          typeof params.identity_type === "string"
            ? params.identity_type
            : undefined,
        );
        if (params.identity_type) {
          throw new Error("per-type ladder should not run");
        }
        return {
          list: [
            {
              identity_id: "typed-id",
              display_name: "Typed identity",
              identity_type: "BC_AUTH_TT",
              identity_bc_id: "bc-typed",
            },
          ],
        } as T;
      },
    });

    assert.deepEqual(identityTypes, [undefined]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity_type, "BC_AUTH_TT");
  });

  it("reads identity_bc_id from each candidate key", () => {
    assert.deepEqual(
      extractIdentityBcId({ identity_authorized_bc_id: "bc-auth" }),
      {
        value: "bc-auth",
        key: "identity_authorized_bc_id",
      },
    );
    assert.deepEqual(extractIdentityBcId({ identity_bc_id: "bc-a" }), {
      value: "bc-a",
      key: "identity_bc_id",
    });
    assert.deepEqual(extractIdentityBcId({ bc_id: "bc-b" }), {
      value: "bc-b",
      key: "bc_id",
    });
    assert.deepEqual(extractIdentityBcId({ business_center_id: "bc-c" }), {
      value: "bc-c",
      key: "business_center_id",
    });
    assert.deepEqual(extractIdentityBcId({ identity_id: "id-1" }), {
      value: null,
      key: null,
    });
  });

  it("extracts identity_authorized_bc_id from the measured production row keys", () => {
    assert.deepEqual(
      Object.keys(PRODUCTION_IDENTITY_ROW),
      [
        "ads_only_mode",
        "available_status",
        "can_manage_message",
        "can_pull_video",
        "can_push_video",
        "can_use_live_ads",
        "display_name",
        "identity_authorized_bc_id",
        "identity_id",
        "identity_type",
        "is_gpppa",
        "profile_image",
        "username",
      ],
    );
    assert.deepEqual(extractIdentityBcId(PRODUCTION_IDENTITY_ROW), {
      value: "7078123456789012345",
      key: "identity_authorized_bc_id",
    });
  });

  it("parses the production row without calling /bc/get/", async () => {
    const paths: string[] = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "7639802149165301776",
      token: "token-1",
      request: async <T,>(path: string) => {
        paths.push(path);
        return { list: [PRODUCTION_IDENTITY_ROW] } as T;
      },
    });
    assert.deepEqual(paths, ["/identity/get/"]);
    assert.equal(rows[0]?.identity_type, "BC_AUTH_TT");
    assert.equal(rows[0]?.identity_bc_id, "7078123456789012345");
  });

  it("falls back to /bc/get/ when the identity row has no BC id", async () => {
    const paths: string[] = [];
    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(path: string) => {
        paths.push(path);
        if (path === "/bc/get/") {
          return { list: [{ bc_id: "bc-fallback" }] } as T;
        }
        return {
          list: [
            {
              identity_id: "ironworks",
              display_name: "Ironworks",
              identity_type: "BC_AUTH_TT",
            },
          ],
        } as T;
      },
    });
    assert.ok(paths.includes("/identity/get/"));
    assert.ok(paths.includes("/bc/get/"));
    assert.equal(rows[0]?.identity_bc_id, "bc-fallback");
  });
});

describe("fetchAdvertiserBusinessCenterId", () => {
  it("uses the single BC from /bc/get/", async () => {
    const result = await fetchAdvertiserBusinessCenterId({
      advertiserId: "adv-1",
      token: "token-1",
      request: async <T,>(path: string) => {
        assert.equal(path, "/bc/get/");
        return { list: [{ bc_id: "bc-only" }] } as T;
      },
    });
    assert.deepEqual(result, { bcId: "bc-only", path: "bc/get" });
  });

  it("matches the advertiser across multiple BCs via /bc/advertiser/get/", async () => {
    const result = await fetchAdvertiserBusinessCenterId({
      advertiserId: "adv-1",
      token: "token-1",
      request: async <T,>(path: string, params: Record<string, unknown>) => {
        if (path === "/bc/get/") {
          return { list: [{ bc_id: "bc-a" }, { bc_id: "bc-b" }] } as T;
        }
        assert.equal(path, "/bc/advertiser/get/");
        if (params.bc_id === "bc-b") {
          return { list: [{ advertiser_id: "adv-1" }] } as T;
        }
        return { list: [{ advertiser_id: "other" }] } as T;
      },
    });
    assert.deepEqual(result, { bcId: "bc-b", path: "bc/advertiser/get" });
  });

  it("reads nested bc_info ids and matches a numeric advertiser_id", async () => {
    const result = await fetchAdvertiserBusinessCenterId({
      advertiserId: "7639802149165301776",
      token: "token-1",
      request: async <T,>(path: string, params: Record<string, unknown>) => {
        if (path === "/bc/get/") {
          return {
            list: [
              { bc_info: { bc_id: "bc-1" }, user_role: "ADMIN" },
              { bc_info: { bc_id: "bc-2" }, user_role: "ADMIN" },
              { bc_info: { bc_id: "bc-3" }, user_role: "ADMIN" },
              { bc_info: { bc_id: "bc-4" }, user_role: "ADMIN" },
              { bc_info: { bc_id: "bc-5" }, user_role: "ADMIN" },
            ],
            page_info: {},
            parent_bc: null,
          } as T;
        }
        assert.equal(path, "/bc/advertiser/get/");
        if (params.bc_id === "bc-4") {
          return { list: [{ advertiser_id: 1234567890 }] } as T;
        }
        if (params.bc_id === "bc-5") {
          return { list: [{ advertiser_id: "7639802149165301776" }] } as T;
        }
        return { list: [{ advertiser_id: 111 }] } as T;
      },
    });
    assert.deepEqual(result, { bcId: "bc-5", path: "bc/advertiser/get" });
  });

  it("treats a numeric advertiser_id as a match", async () => {
    const result = await fetchAdvertiserBusinessCenterId({
      advertiserId: "1234567890",
      token: "token-1",
      request: async <T,>(path: string, params: Record<string, unknown>) => {
        if (path === "/bc/get/") {
          return {
            list: [
              { bc_info: { bc_id: "bc-a" }, user_role: "ADMIN" },
              { bc_info: { bc_id: "bc-b" }, user_role: "ADMIN" },
            ],
          } as T;
        }
        if (params.bc_id === "bc-b") {
          return { list: [{ advertiser_id: 1234567890 }] } as T;
        }
        return { list: [{ advertiser_id: "other" }] } as T;
      },
    });
    assert.deepEqual(result, { bcId: "bc-b", path: "bc/advertiser/get" });
  });
});

describe("extractBcIdsFromList", () => {
  it("reads bc_id from nested bc_info", () => {
    assert.deepEqual(
      extractBcIdsFromList({
        list: [{ bc_info: { bc_id: "bc-nested" }, user_role: "ADMIN" }],
      }),
      ["bc-nested"],
    );
  });
});
