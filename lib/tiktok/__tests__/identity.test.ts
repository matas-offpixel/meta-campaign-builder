import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchTikTokIdentities } from "../identity.ts";

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
            },
          ],
        }) as T,
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].identity_type, "BC_AUTH_TT");
  });
});
