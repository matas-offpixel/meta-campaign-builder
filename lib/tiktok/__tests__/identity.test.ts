import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchTikTokIdentities } from "../identity.ts";

describe("fetchTikTokIdentities", () => {
  it("queries each supported identity type and merges rows", async () => {
    const identityTypes: string[] = [];

    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(
        _path: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        identityTypes.push(String(params.identity_type));
        return {
          list: [
            {
              identity_id: `identity-${params.identity_type}`,
              display_name: `Identity ${params.identity_type}`,
              avatar_url: "https://example.com/avatar.jpg",
            },
          ],
        } as T;
      },
    });

    assert.deepEqual(identityTypes, [
      "BC_AUTH_TT",
      "AUTH_CODE",
      "CUSTOMIZED_USER",
      "TT_USER",
    ]);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].identity_type, "AUTH_CODE");
    assert.equal(rows[0].display_name, "Identity AUTH_CODE");
  });
});
