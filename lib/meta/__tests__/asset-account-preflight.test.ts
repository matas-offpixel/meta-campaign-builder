import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectAdImageHashes,
  hashesInAdImagesResponse,
  refuseForeignAssets,
  videoIdsProvenOnAnotherAccount,
  type AssetAccountCheck,
} from "../asset-account-preflight.ts";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../__fixtures__/account-scope/adimages-hashes.json", import.meta.url)),
    "utf8",
  ),
) as {
  adAccountId: string;
  hashes: string[];
  pages: Array<{ data?: Array<{ hash?: string }>; paging?: { next?: string } }>;
};

const pageOne = hashesInAdImagesResponse(fixture.pages[0]);
const knownHash = fixture.hashes[0]!;
const secondHash = fixture.hashes[1]!;

function wouldPost(checks: AssetAccountCheck[], videos: ReadonlySet<string>): boolean {
  const refusal = refuseForeignAssets({
    checks,
    presentHashes: pageOne,
    videoIdsInOtherAccount: videos,
  });
  if (refusal) return false;
  return true;
}

describe("foreign asset preflight", () => {
  it("reads hash from the captured adimages response", () => {
    assert.equal(fixture.adAccountId, "act_1073273492854557");
    assert.ok(pageOne.has(knownHash));
    assert.equal(pageOne.has(secondHash), false);
  });

  it("a hash missing from adimages refuses before POST", () => {
    let posted = false;
    const checks: AssetAccountCheck[] = [
      {
        kind: "image",
        key: "not-in-this-account",
        fileName: "poster.jpg",
        creativeName: "Artwork",
      },
    ];
    const refusal = refuseForeignAssets({
      checks,
      presentHashes: pageOne,
      videoIdsInOtherAccount: new Set(),
    });
    if (!refusal) posted = true;
    assert.equal(posted, false);
    assert.equal(
      refusal,
      "Image poster.jpg on Artwork was uploaded to a different ad account — re-upload it.",
    );
  });

  it("all present hashes pass", () => {
    const checks: AssetAccountCheck[] = [
      {
        kind: "image",
        key: knownHash,
        fileName: "poster.jpg",
        creativeName: "Artwork",
      },
    ];
    assert.equal(wouldPost(checks, new Set()), true);
    assert.equal(
      refuseForeignAssets({
        checks,
        presentHashes: pageOne,
        videoIdsInOtherAccount: new Set(),
      }),
      null,
    );
  });

  it("a video with no registry row does not refuse", () => {
    const checks: AssetAccountCheck[] = [
      {
        kind: "video",
        key: "120250000000000000",
        fileName: "clip.mp4",
        creativeName: "Artwork",
      },
    ];
    assert.equal(
      refuseForeignAssets({
        checks,
        presentHashes: pageOne,
        videoIdsInOtherAccount: new Set(),
      }),
      null,
    );
    const classified = videoIdsProvenOnAnotherAccount(checks, [], "act_606252931141334");
    assert.deepEqual([...classified.foreign], []);
    assert.deepEqual(classified.unverified, ["120250000000000000"]);
  });

  it("walks a two-page adimages response and refuses a hash missing after the walk", async () => {
    const fetched: string[] = [];
    const present = await collectAdImageHashes({
      hashes: [...fixture.hashes, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      fetchPage: async (query) => {
        if ("next" in query) {
          fetched.push("next");
          assert.equal(query.next, fixture.pages[0]?.paging?.next);
          return fixture.pages[1];
        }
        fetched.push(query.limit);
        assert.equal(query.limit, "50");
        assert.deepEqual(query.hashes, [
          knownHash,
          secondHash,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ]);
        return fixture.pages[0];
      },
    });
    assert.deepEqual(fetched, ["50", "next"]);
    assert.ok(present.has(knownHash));
    assert.ok(present.has(secondHash));
    assert.equal(present.has("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
    const refusal = refuseForeignAssets({
      checks: [
        {
          kind: "image",
          key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          fileName: "other.jpg",
          creativeName: "Artwork",
        },
      ],
      presentHashes: present,
      videoIdsInOtherAccount: new Set(),
    });
    assert.match(refusal ?? "", /Image other\.jpg on Artwork was uploaded to a different ad account/);
    assert.equal(
      refuseForeignAssets({
        checks: [
          { kind: "image", key: secondHash, fileName: "page-two.jpg", creativeName: "Artwork" },
        ],
        presentHashes: present,
        videoIdsInOtherAccount: new Set(),
      }),
      null,
    );
  });
});
