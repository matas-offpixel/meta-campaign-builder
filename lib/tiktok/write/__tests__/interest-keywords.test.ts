import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../../types/tiktok-draft.ts";
import {
  hydrateDraftInterestKeywordIds,
  staleTikTokKeywordChips,
  stampNewTikTokKeywordChips,
  TIKTOK_KEYWORD_STALE_MS,
} from "../interest-keywords.ts";

function draftWithKeywords() {
  const draft = createDefaultTikTokDraft("draft-kw");
  draft.accountSetup.advertiserId = "advertiser-1";
  draft.audiences.interestGroups = [
    {
      id: "g-house",
      name: "House",
      interestIds: [
        { id: "kw-live", name: "house music", kind: "keyword" },
        { id: "kw-dead", name: "warehouse rave", kind: "keyword" },
      ],
      hashtagIds: [],
      behaviourIds: [],
    },
  ];
  return draft;
}

describe("hydrateDraftInterestKeywordIds", () => {
  it("records chips TikTok no longer indexes without dropping them from the draft", async () => {
    const draft = draftWithKeywords();
    const retired = await hydrateDraftInterestKeywordIds({
      draft,
      token: "token-1",
      request: async <T,>(path: string): Promise<T> => {
        assert.equal(path, "/tool/interest_keyword/get/");
        return {
          interest_keywords: [{ keyword_id: "kw-live", keyword: "house music" }],
        } as T;
      },
    });
    assert.equal(retired.length, 1);
    assert.equal(retired[0]?.groupName, "House");
    assert.deepEqual(retired[0]?.items, [
      { id: "kw-dead", name: "warehouse rave" },
    ]);
    assert.deepEqual(
      draft.audiences.interestGroups[0]?.interestIds.map((item) => item.id),
      ["kw-live", "kw-dead"],
    );
  });

  it("treats a zero-row resolve as unverified instead of retiring every chip", async () => {
    const draft = draftWithKeywords();
    const retired = await hydrateDraftInterestKeywordIds({
      draft,
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({ unexpected: { foo: 1 } }) as T,
    });
    assert.deepEqual(retired, []);
  });

  it("returns no retirements when every keyword id still resolves", async () => {
    const draft = draftWithKeywords();
    const retired = await hydrateDraftInterestKeywordIds({
      draft,
      token: "token-1",
      request: async <T,>(): Promise<T> =>
        ({
          interest_keywords: [
            { keyword_id: "kw-live", keyword: "house music" },
            { keyword_id: "kw-dead", keyword: "warehouse rave" },
          ],
        }) as T,
    });
    assert.deepEqual(retired, []);
  });
});

describe("staleTikTokKeywordChips", () => {
  it("warns only when resolvedAt is older than 14 days", () => {
    const draft = draftWithKeywords();
    const now = new Date("2026-08-22T12:00:00.000Z");
    draft.audiences.interestGroups[0]!.interestIds = [
      {
        id: "kw-old",
        name: "old",
        kind: "keyword",
        resolvedAt: new Date(now.getTime() - TIKTOK_KEYWORD_STALE_MS - 1).toISOString(),
      },
      {
        id: "kw-fresh",
        name: "fresh",
        kind: "keyword",
        resolvedAt: now.toISOString(),
      },
      { id: "kw-unknown", name: "unknown", kind: "keyword" },
    ];
    const stale = staleTikTokKeywordChips(draft, now);
    assert.deepEqual(
      stale.map((item) => item.id),
      ["kw-old"],
    );
  });
});

describe("stampNewTikTokKeywordChips", () => {
  it("does not stamp previously-saved chips that lack resolvedAt", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const current = [
      { id: "kw-saved", name: "saved", kind: "keyword" as const },
    ];
    const incoming = [
      { id: "kw-saved", name: "saved", kind: "keyword" as const },
      { id: "kw-new", name: "new", kind: "keyword" as const },
    ];
    const stamped = stampNewTikTokKeywordChips(current, incoming, now);
    assert.equal(stamped[0]?.resolvedAt, undefined);
    assert.equal(stamped[1]?.resolvedAt, now.toISOString());
  });
});
