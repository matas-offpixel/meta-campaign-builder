import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  hashesInAdImagesResponse,
  refuseForeignAssets,
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
  response: unknown;
};

const present = hashesInAdImagesResponse(fixture.response);
const knownHash = fixture.hashes[0]!;

function wouldPost(checks: AssetAccountCheck[], videos: ReadonlySet<string>): boolean {
  const refusal = refuseForeignAssets({
    checks,
    presentHashes: present,
    videoIdsInAccount: videos,
  });
  if (refusal) return false;
  return true;
}

describe("foreign asset preflight", () => {
  it("reads hash from the captured adimages response", () => {
    assert.equal(fixture.adAccountId, "act_1073273492854557");
    assert.ok(present.has(knownHash));
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
      presentHashes: present,
      videoIdsInAccount: new Set(),
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
        presentHashes: present,
        videoIdsInAccount: new Set(),
      }),
      null,
    );
  });

  it("a video with no registry row for this account refuses", () => {
    const checks: AssetAccountCheck[] = [
      {
        kind: "video",
        key: "120250000000000000",
        fileName: "clip.mp4",
        creativeName: "Artwork",
      },
    ];
    const refusal = refuseForeignAssets({
      checks,
      presentHashes: present,
      videoIdsInAccount: new Set(),
    });
    assert.match(
      refusal ?? "",
      /Video clip\.mp4 on Artwork was uploaded to a different ad account — re-upload it\./,
    );
    assert.equal(
      refuseForeignAssets({
        checks,
        presentHashes: present,
        videoIdsInAccount: new Set(["120250000000000000"]),
      }),
      null,
    );
  });
});
