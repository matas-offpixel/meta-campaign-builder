import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchAdvertiserCampaignNames,
  suggestTikTokCampaignNameAlternative,
  tikTokCampaignNameCollisionMessage,
  tikTokEventCodePrefix,
} from "../write/campaign-names.ts";

describe("suggestTikTokCampaignNameAlternative", () => {
  it("keeps the exact [EVENT_CODE] prefix and only appends a suffix", () => {
    const original = "[IRW0001] Jamie Jones -sig";
    const suggested = suggestTikTokCampaignNameAlternative(original);
    assert.equal(tikTokEventCodePrefix(suggested), "[IRW0001]");
    assert.ok(suggested.startsWith("[IRW0001]"));
    assert.equal(suggested, "[IRW0001] Jamie Jones -sig (2)");
    assert.equal(suggested.indexOf("[IRW0001]"), 0);
    assert.ok(!suggested.slice(1).includes("[IRW0001]"));
  });

  it("skips suffixes that are already taken", () => {
    const suggested = suggestTikTokCampaignNameAlternative(
      "[IRW0001] Jamie Jones -sig",
      ["[IRW0001] Jamie Jones -sig (2)"],
    );
    assert.equal(suggested, "[IRW0001] Jamie Jones -sig (3)");
    assert.ok(suggested.startsWith("[IRW0001]"));
  });
});

describe("tikTokCampaignNameCollisionMessage", () => {
  it("names the conflict and tells the user to change Step 2", () => {
    const message = tikTokCampaignNameCollisionMessage(
      "[IRW0001] Jamie Jones -sig",
    );
    assert.match(message, /\[IRW0001\] Jamie Jones -sig/);
    assert.match(message, /Step 2/);
    assert.match(message, /\[IRW0001\] Jamie Jones -sig \(2\)/);
  });
});

describe("fetchAdvertiserCampaignNames", () => {
  it("reads campaign_name from paginated /campaign/get/ rows", async () => {
    const names = await fetchAdvertiserCampaignNames({
      advertiserId: "7639802149165301776",
      token: "token-1",
      request: async <T,>(_path: string, params: Record<string, unknown>) => {
        const page = typeof params.page === "number" ? params.page : 1;
        if (page === 1) {
          return {
            list: [{ campaign_id: "c1", campaign_name: "[IRW0001] Jamie Jones -sig" }],
            page_info: { total_page: 2 },
          } as T;
        }
        return {
          list: [{ campaign_id: "c2", campaign_name: "[IRW0001] Other" }],
          page_info: { total_page: 2 },
        } as T;
      },
    });
    assert.deepEqual(names, [
      "[IRW0001] Jamie Jones -sig",
      "[IRW0001] Other",
    ]);
  });
});
