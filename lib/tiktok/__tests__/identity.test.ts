import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchTikTokIdentities } from "../identity.ts";

describe("fetchTikTokIdentities", () => {
  it("queries each supported identity type and merges rows", async () => {
    const identityTypes: string[] = [];

    const rows = await fetchTikTokIdentities({
      advertiserId: "advertiser-1",
      token: "token-1",
      request: async <T,>(_path, params): Promise<T> => {
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
      "PERSONAL_HUB",
      "CUSTOMIZED_USER",
      "TT_USER",
    ]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].identity_type, "CUSTOMIZED_USER");
    assert.equal(rows[0].display_name, "Identity CUSTOMIZED_USER");
  });
});
