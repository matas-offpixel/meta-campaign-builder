import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createSha256, sha256HexOfBlob } from "../sha256-stream.ts";

function nodeHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("streaming SHA-256", () => {
  it("matches the empty digest", () => {
    const hasher = createSha256();
    assert.equal(
      hasher.digestHex(),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches a one-block message and a message split across updates", () => {
    const bytes = new TextEncoder().encode("abc");
    const whole = createSha256();
    whole.update(bytes);
    const wholeHex = whole.digestHex();
    assert.equal(wholeHex, nodeHex(bytes));

    const split = createSha256();
    split.update(bytes.subarray(0, 1));
    split.update(bytes.subarray(1));
    assert.equal(split.digestHex(), wholeHex);
  });

  it("matches node across a multi-block buffer, including a 64-byte boundary", () => {
    const bytes = new Uint8Array(200);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    const hasher = createSha256();
    hasher.update(bytes.subarray(0, 64));
    hasher.update(bytes.subarray(64, 130));
    hasher.update(bytes.subarray(130));
    assert.equal(hasher.digestHex(), nodeHex(bytes));
  });

  it("hashes a blob from its stream", async () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17) & 0xff;
    const hashed = await sha256HexOfBlob(new Blob([bytes]));
    assert.equal(hashed.byteSize, bytes.byteLength);
    assert.equal(hashed.contentHash, nodeHex(bytes));
  });

  it("the upload hook sends the hash for videos and not for images", () => {
    const hook = readFileSync(new URL("../../hooks/useUploadAsset.ts", import.meta.url), "utf8");
    assert.match(hook, /sha256HexOfBlob\(params\.file\)/);
    assert.match(hook, /params\.type === "video" \? \{ contentHash, byteSize \}/);
  });
});
