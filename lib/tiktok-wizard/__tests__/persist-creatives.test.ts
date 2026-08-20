import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  commitUploadedTikTokCreatives,
  formatTikTokCreativePersistFailure,
} from "../persist-creatives.ts";

describe("commitUploadedTikTokCreatives", () => {
  it("N uploaded videos become N persisted creatives and survive a reload", async () => {
    let n = 0;
    const store = { draft: createDefaultTikTokDraft("draft-1") };
    const uploads = [
      {
        videoId: "v1",
        thumbnailUrl: "https://cdn.example/1.jpg",
        thumbnailExpiresAt: "2026-08-20T18:00:00.000Z",
        durationSeconds: 8,
        fileName: "one.mp4",
      },
      {
        videoId: "v2",
        thumbnailUrl: "https://cdn.example/2.jpg",
        thumbnailExpiresAt: "2026-08-20T18:00:00.000Z",
        durationSeconds: 9,
        fileName: "two.mp4",
      },
      {
        videoId: "v3",
        thumbnailUrl: "https://cdn.example/3.jpg",
        thumbnailExpiresAt: "2026-08-20T18:00:00.000Z",
        durationSeconds: 10,
        fileName: "three.mp4",
      },
    ];

    for (const upload of uploads) {
      await commitUploadedTikTokCreatives({
        readItems: () =>
          JSON.parse(JSON.stringify(store.draft.creatives.items)),
        writeItems: async (items) => {
          store.draft = JSON.parse(
            JSON.stringify({
              ...store.draft,
              creatives: { items },
              updatedAt: new Date().toISOString(),
            }),
          );
        },
        upload,
        baseName: "Hero",
        adText: "Book now",
        displayName: "Brand",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        newId: () => `id-${++n}`,
      });
    }

    const reloaded = JSON.parse(JSON.stringify(store.draft));
    assert.equal(reloaded.creatives.items.length, 3);
    assert.deepEqual(
      reloaded.creatives.items.map((item: { videoId: string }) => item.videoId),
      ["v1", "v2", "v3"],
    );
  });

  it("a failed draft write keeps the server's own message", async () => {
    const store = { items: [] as unknown[] };
    await assert.rejects(
      () =>
        commitUploadedTikTokCreatives({
          readItems: () => [],
          writeItems: async () => {
            throw new Error("Draft not found");
          },
          upload: {
            videoId: "v1",
            thumbnailUrl: null,
            durationSeconds: 1,
            fileName: "one.mp4",
          },
          baseName: "Hero",
          adText: "Book now",
          displayName: "Brand",
          landingPageUrl: "https://example.com",
          cta: "LEARN_MORE",
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const jobError = formatTikTokCreativePersistFailure(err.message);
        assert.match(jobError, /Draft not found/);
        assert.match(jobError, /failed to save the creative to this draft/);
        return true;
      },
    );
    assert.equal(store.items.length, 0);
  });
});
