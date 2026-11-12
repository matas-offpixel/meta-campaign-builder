import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import {
  importQualityLine,
  partWindow,
  planVideoRowLine,
  tripleFitSource,
  videoDraftHold,
} from "../import-quality.ts";
import { usableClips } from "../selection.ts";
import {
  clipBucket,
  clipTileName,
  groupClips,
  madeTripleFitSentence,
  showTripleFitOffer,
  type ClipForGroup,
} from "../surface.ts";
import { makeTripleFit } from "../make-triple-fit.ts";
import { fakeDb } from "./fake-db.ts";

function clip(over: Partial<ClipForGroup> & Pick<ClipForGroup, "id">): ClipForGroup {
  return {
    artistId: "ada",
    artistName: "Ada North",
    clipNo: 1,
    cleared: true,
    renderError: null,
    durationSeconds: 18,
    judged: null,
    owner: "artist",
    ...over,
  };
}

const vertical = clip({ id: "v", sourceWidth: 1080, sourceHeight: 1920 });

describe("triple-fit classification", () => {
  it("imports a landscape whose part window clears 675 px and refuses one that does not", () => {
    const luke = { width: 1920, height: 1080 };
    const small = { width: 956, height: 718 };
    const neither = { width: 640, height: 360 };
    assert.ok(partWindow(luke).width > 1800);
    assert.ok(partWindow(small).width >= 956);
    assert.ok(partWindow(neither).width < 675);
    assert.equal(tripleFitSource(luke), true);
    assert.equal(tripleFitSource(small), true);
    assert.equal(tripleFitSource(neither), false);
    assert.equal(tripleFitSource({ width: 720, height: 1280 }), false);
    assert.equal(tripleFitSource({ width: 3840, height: 2160 }), false);
    assert.equal(importQualityLine(luke), null);
    assert.equal(importQualityLine(small), null);
    assert.match(importQualityLine(neither) ?? "", /Clip too small for 9:16/);
  });

  it("keeps the landscape out of a single-clip round and offers one triple-fit under three runnable clips", () => {
    const landscape = clip({ id: "wide", clipNo: 15, sourceWidth: 1920, sourceHeight: 1080, durationSeconds: 24 });
    const tiny = clip({ id: "tiny", sourceWidth: 640, sourceHeight: 360 });
    const two = [vertical, clip({ id: "v2", sourceWidth: 720, sourceHeight: 1280 }), landscape, tiny];
    assert.equal(clipBucket(landscape), "triple");
    assert.equal(clipBucket(tiny), "cant");
    assert.deepEqual(groupClips(two).triple.map((row) => row.id), ["wide"]);
    assert.equal(showTripleFitOffer(landscape, two), true);
    const three = [...two, clip({ id: "v3", sourceWidth: 1080, sourceHeight: 1920 })];
    assert.equal(showTripleFitOffer(landscape, three), false);
    assert.equal(showTripleFitOffer({ ...landscape, owner: "promoter", artistId: null }, [landscape]), false);
    assert.equal(showTripleFitOffer({ ...landscape, durationSeconds: 4 }, [landscape]), false);
    assert.equal(showTripleFitOffer(landscape, [...two, clip({ id: "made", tripleFitSourceId: "wide", sourceWidth: 1920, sourceHeight: 1080 })]), false);
  });

  it("names the made clip from the source number and keeps it out of caption rounds", () => {
    const made = clip({ id: "made", clipNo: 22, tripleFitSourceId: "wide", tripleFitSourceNo: 15, sourceWidth: 1920, sourceHeight: 1080 });
    assert.equal(clipTileName(made), "Triple-fit · #15");
    assert.equal(clipBucket(made), "new");
    assert.equal(madeTripleFitSentence(made), "T1 only — not paired with captions");
    assert.equal(usableClips([made]).length, 0);
    assert.equal(showTripleFitOffer(made, [made]), false);
  });

  it("writes one triple-fit row and refuses a second from the same clip", async () => {
    const fake = fakeDb({
      creative_lab_clips: [{
        id: "wide",
        user_id: "op",
        artist_id: "ada",
        owner: "artist",
        creative_asset_id: "asset-1",
        clip_no: 15,
        source: "file",
        rights_ref: "kit",
        audio_match: true,
        source_width: 1920,
        source_height: 1080,
        in_s: 0,
        out_s: 12,
      }],
      creative_assets: [{ id: "asset-1", storage_path: "videos/wide.mp4", duration_seconds: 12 }],
    });
    const first = await makeTripleFit(fake as unknown as ServiceRoleDb, { userId: "op", clipId: "wide" });
    const made = fake.tables.creative_lab_clips.find((row) => row.id === first.clipId);
    assert.equal(made?.triple_fit_source_id, "wide");
    assert.equal(made?.audio_match, true);
    assert.equal(made?.creative_asset_id, "asset-1");
    assert.equal(made?.clip_no, 16);
    await assert.rejects(
      makeTripleFit(fake as unknown as ServiceRoleDb, { userId: "op", clipId: "wide" }),
      /already has a triple-fit/,
    );
    assert.equal(fake.tables.creative_lab_clips.length, 2);
  });

  it("names the plan-row lines and holds a 4:5 or 1:1 video creative", () => {
    assert.equal(planVideoRowLine({ mediaKind: "video", width: 956, height: 718, bucket: "other" }), "Too small for 9:16");
    assert.equal(planVideoRowLine({ mediaKind: "video", width: 640, height: 360, bucket: "other" }), "Too small for 9:16");
    assert.equal(planVideoRowLine({ mediaKind: "video", width: 1080, height: 1350, bucket: "4:5" }), "Video runs as 9:16 only");
    assert.equal(planVideoRowLine({ mediaKind: "video", width: 1080, height: 1920, bucket: "9:16" }), null);
    assert.equal(planVideoRowLine({ mediaKind: "image", width: 1080, height: 1350, bucket: "4:5" }), null);
    assert.equal(videoDraftHold({
      mediaType: "video",
      assetVariations: [{ assets: [{ aspectRatio: "4:5" }] }],
    }), "Video runs as 9:16 only");
    assert.equal(videoDraftHold({
      mediaType: "image",
      assetVariations: [{ assets: [{ aspectRatio: "4:5" }] }],
    }), null);
  });
});
