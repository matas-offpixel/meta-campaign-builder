import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import sharp from "sharp";

import { compressUploadImage } from "../compress-upload-image.ts";
import { MAX_IMAGE_BYTES } from "../upload.ts";
import { LARGE_VIDEO_NOTICE, planCreativeUpload } from "../upload-size-guard.ts";

const MB = 1024 * 1024;

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing ${start} .. ${end}`);
  return source.slice(from, to);
}

describe("planCreativeUpload", () => {
  it("refuses a 31 MB image and names the file size and the 30 MB limit", () => {
    const plan = planCreativeUpload({ byteSize: 31 * MB, mediaType: "image" });
    assert.equal(plan.action, "refuse");
    if (plan.action !== "refuse") return;
    assert.match(plan.message, /31\.0 MB/);
    assert.match(plan.message, /Maximum is 30 MB/);
    assert.equal(
      plan.message,
      "File too large (31.0 MB). Maximum is 30 MB.",
    );
  });

  it("uploads a 25 MB image with no notice and no compression flag", () => {
    assert.deepEqual(
      planCreativeUpload({ byteSize: 25 * MB, mediaType: "image" }),
      { action: "upload" },
    );
  });

  it("refuses a 201 MB video and names the 200 MB limit", () => {
    const plan = planCreativeUpload({ byteSize: 201 * MB, mediaType: "video" });
    assert.equal(plan.action, "refuse");
    if (plan.action !== "refuse") return;
    assert.match(plan.message, /201\.0 MB/);
    assert.match(plan.message, /Maximum is 200 MB/);
  });

  it("uploads a 45 MB video with the large-video notice", () => {
    assert.deepEqual(
      planCreativeUpload({ byteSize: 45 * MB, mediaType: "video" }),
      { action: "upload", notice: LARGE_VIDEO_NOTICE },
    );
    assert.equal(
      LARGE_VIDEO_NOTICE,
      "Large video — upload goes via Storage and may take a minute.",
    );
  });
});

describe("creatives slot calls the plan before any upload", () => {
  const src = readFileSync("components/steps/creatives.tsx", "utf8");
  const handle = between(src, "async function handleFile(file: File)", "function handleDragOver");

  it("returns from the refuse branch before upload(", () => {
    const planAt = handle.indexOf("planCreativeUpload(");
    const refuseAt = handle.indexOf('plan.action === "refuse"');
    const uploadAt = handle.indexOf("await upload(");
    assert.ok(planAt >= 0 && refuseAt > planAt && uploadAt > refuseAt);
    const refuseBranch = handle.slice(refuseAt, uploadAt);
    assert.match(refuseBranch, /return;/);
    assert.equal(refuseBranch.includes("upload("), false);
  });

  it("renders the notice and the compressed output size on the slot", () => {
    assert.match(src, /\{uploadNotice\}/);
    assert.match(handle, /result\.compressedBytes/);
    assert.match(handle, /Compressed to /);
  });
});

describe("upload route image compression", () => {
  const route = readFileSync("lib/meta/upload-asset-handler.ts", "utf8");

  it("calls the compressor only when the image is over MAX_IMAGE_BYTES", () => {
    const body = route.replace(
      /import \{ compressUploadImage \} from "\.\/compress-upload-image\.ts";\n/,
      "",
    );
    const parts = body.split("compressUploadImage");
    assert.equal(parts.length, 3, "expected two image-branch compressor calls");
    for (const before of parts.slice(0, -1)) {
      assert.match(before.slice(-220), /imageFile\.size > MAX_IMAGE_BYTES/);
    }
  });

  it("does not reference the compressor on the file_url branch", () => {
    const fileUrl = between(
      route,
      'metaVideoUploadMode() === "file_url"',
      "Step 1:",
    );
    assert.equal(fileUrl.includes("compressUploadImage"), false);
    assert.equal(fileUrl.includes("compress-upload-image"), false);
    assert.match(fileUrl, /uploadStoredVideoByUrl/);
  });
});

describe("compressUploadImage", () => {
  it("starts JPEG quality at 92", () => {
    const src = readFileSync("lib/meta/compress-upload-image.ts", "utf8");
    assert.match(src, /QUALITY_START = 92/);
  });

  it("compresses a PNG over 30 MB to a JPEG under the limit with the same aspect", async () => {
    const width = 4200;
    const height = 2800;
    const png = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 30, g: 90, b: 180 },
      },
    }).png({ compressionLevel: 0 }).toBuffer();
    assert.ok(png.length > MAX_IMAGE_BYTES);

    const compressed = await compressUploadImage(new Uint8Array(png));
    assert.ok(compressed.byteLength < MAX_IMAGE_BYTES);
    assert.equal(compressed.byteLength, compressed.bytes.byteLength);

    const inputMeta = await sharp(png).metadata();
    const outputMeta = await sharp(compressed.bytes).metadata();
    assert.equal(outputMeta.format, "jpeg");
    assert.ok(inputMeta.width && inputMeta.height);
    assert.ok(outputMeta.width && outputMeta.height);
    const inputAspect = inputMeta.width / inputMeta.height;
    const outputAspect = outputMeta.width / outputMeta.height;
    assert.ok(
      Math.abs(inputAspect - outputAspect) < 0.01,
      `aspect ${inputAspect} vs ${outputAspect}`,
    );
  });
});
