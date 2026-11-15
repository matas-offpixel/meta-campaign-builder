/**
 * The loopback server ffmpeg reads an over-cap original through, and the
 * range reads the probe uses. The origin here is a fake that requires a
 * token, the way Drive does; nothing a client of the server sees carries it.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { makeColumnProxyFile } from "../../creative-lab/render-proxy.ts";
import { probeMp4File, probeMp4Reader } from "../../creative-lab/mp4-probe.ts";
import { remoteOriginal, serveRanges, type FetchRange } from "../remote-file.ts";

const TOKEN = "ya29.TEST-SECRET-TOKEN";

/** A fake Drive: the whole file or one range of `bytes`. Records the ranges asked for. */
function origin(bytes: Uint8Array) {
  const ranges: (string | null)[] = [];
  const fetchRange: FetchRange = async (range) => {
    // The real origin (DriveApi.fetchMedia) adds the token here, inside the closure; nothing it returns carries it.
    ranges.push(range);
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (!m) return new Response(bytes.slice(), { status: 200, headers: { "content-length": String(bytes.byteLength), "content-type": "video/mp4" } });
    const start = Number(m[1]);
    const end = Math.min(m[2] ? Number(m[2]) : bytes.byteLength - 1, bytes.byteLength - 1);
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${bytes.byteLength}`, "content-type": "video/mp4" },
    });
  };
  return { ranges, fetchRange };
}

describe("serveRanges", () => {
  it("serves the whole file, a range and HEAD on its random path; anything else is 404", async () => {
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const { fetchRange, ranges } = origin(bytes);
    const served = await serveRanges(fetchRange);
    try {
      assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
      assert.ok(!served.url.includes(TOKEN));
      const whole = await fetch(served.url);
      assert.equal(whole.status, 200);
      assert.equal(whole.headers.get("accept-ranges"), "bytes");
      assert.deepEqual(new Uint8Array(await whole.arrayBuffer()), bytes);
      const part = await fetch(served.url, { headers: { Range: "bytes=10-19" } });
      assert.equal(part.status, 206);
      assert.equal(part.headers.get("content-range"), "bytes 10-19/1000");
      assert.deepEqual(new Uint8Array(await part.arrayBuffer()), bytes.slice(10, 20));
      const head = await fetch(served.url, { method: "HEAD" });
      assert.equal(head.headers.get("content-length"), "1000");
      assert.equal((await fetch(served.url.replace(/\/[0-9a-f]+$/, "/other"))).status, 404);
      assert.deepEqual(ranges, [null, "bytes=10-19", null]);
    } finally {
      await served.close();
    }
  });

  it("an origin that fails gives the client a bare 502: no message, no token", async () => {
    const served = await serveRanges(async () => {
      throw new Error(`Drive said no to Authorization: Bearer ${TOKEN} at https://www.googleapis.com/drive/v3/files/x?alt=media`);
    });
    try {
      const res = await fetch(served.url);
      assert.equal(res.status, 502);
      assert.equal(await res.text(), "");
    } finally {
      await served.close();
    }
  });
});

describe("remoteOriginal", () => {
  it("fingerprints in one pass and reads ranges; an origin that ignores the range is refused, not read whole", async () => {
    const bytes = new Uint8Array(5000).map((_, i) => (i * 7) % 256);
    const { fetchRange } = origin(bytes);
    const remote = remoteOriginal(fetchRange);
    const identity = await remote.fingerprint();
    assert.equal(identity.byteSize, 5000);
    assert.equal(identity.contentHash, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(new Uint8Array(await remote.readRange(100, 50)), bytes.slice(100, 150));

    const ignoring = remoteOriginal(async () => new Response(bytes.slice(), { status: 200 }));
    await assert.rejects(() => ignoring.readRange(0, 16), /ignored a range request/);
  });
});

const ffmpegPath = (() => {
  try {
    const resolved = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
})();

describe("ffmpeg-static reading an original through serveRanges", { skip: ffmpegPath ? false : "no ffmpeg-static binary" }, () => {
  it("a landscape 4K with its moov after mdat: probed by ranges, then made into the 1080 × 1920 column with only the copy on disk", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "remote-ffmpeg-"));
    try {
      const source = path.join(dir, "4k.mp4");
      execFileSync(ffmpegPath!, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=10:duration=1",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        source,
      ]);
      const bytes = new Uint8Array(readFileSync(source));
      rmSync(source);
      const { fetchRange, ranges } = origin(bytes);
      const remote = remoteOriginal(fetchRange);

      const probed = await probeMp4Reader({ size: bytes.byteLength, read: (s, n) => remote.readRange(s, n) });
      assert.deepEqual([probed.width, probed.height], [3840, 2160]);
      assert.ok(ranges.every((r) => r !== null), "the probe only reads ranges");

      const served = await remote.serve();
      const output = path.join(dir, "column.mp4");
      try {
        await makeColumnProxyFile(served.url, output, { width: 1080, height: 1920 });
      } finally {
        await served.close();
      }
      const column = await probeMp4File(output);
      assert.deepEqual([column.width, column.height], [1080, 1920]);
      // ffmpeg seeked: the moov sits after mdat, so it asked for more than one range.
      assert.ok(ranges.filter((r) => r?.startsWith("bytes=")).length > 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
