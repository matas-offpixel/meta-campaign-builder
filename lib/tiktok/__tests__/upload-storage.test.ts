import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareTikTokCreativeUpload } from "../upload-route.ts";
import {
  TIKTOK_UPLOAD_BUCKET,
  validateTikTokUploadStorageTarget,
} from "../upload-storage.ts";

const VALID_PATH = "tiktok-videos/11111111-1111-4111-8111-111111111111.mp4";

describe("validateTikTokUploadStorageTarget", () => {
  it("rejects a foreign bucket", () => {
    const target = validateTikTokUploadStorageTarget({
      storageBucket: "landing-page-assets",
      storagePath: VALID_PATH,
    });
    assert.equal(target.ok, false);
    if (!target.ok) assert.match(target.error, /campaign-assets/);
  });

  it("rejects a foreign prefix", () => {
    const target = validateTikTokUploadStorageTarget({
      storageBucket: TIKTOK_UPLOAD_BUCKET,
      storagePath: "landing-page-assets/hero.png",
    });
    assert.equal(target.ok, false);
    if (!target.ok) assert.match(target.error, /tiktok-videos/);
  });

  it("accepts the client prefix and UUID filename", () => {
    const target = validateTikTokUploadStorageTarget({
      storageBucket: TIKTOK_UPLOAD_BUCKET,
      storagePath: VALID_PATH,
    });
    assert.deepEqual(target, {
      ok: true,
      bucket: TIKTOK_UPLOAD_BUCKET,
      path: VALID_PATH,
    });
  });
});

describe("prepareTikTokCreativeUpload", () => {
  it("rejects a foreign bucket and foreign prefix with 400 before any service-role call", () => {
    let opened = 0;
    const openServiceStorage = () => {
      opened += 1;
      throw new Error("service-role opened");
    };

    const badBucket = prepareTikTokCreativeUpload({
      storageBucket: "landing-page-assets",
      storagePath: VALID_PATH,
      advertiserId: "adv-1",
    });
    const badPrefix = prepareTikTokCreativeUpload({
      storageBucket: TIKTOK_UPLOAD_BUCKET,
      storagePath: "other-prefix/11111111-1111-4111-8111-111111111111.mp4",
      advertiserId: "adv-1",
    });

    assert.equal(badBucket.ok, false);
    assert.equal(badPrefix.ok, false);
    if (!badBucket.ok) assert.equal(badBucket.status, 400);
    if (!badPrefix.ok) assert.equal(badPrefix.status, 400);
    assert.equal(opened, 0);
    void openServiceStorage;
  });
});
