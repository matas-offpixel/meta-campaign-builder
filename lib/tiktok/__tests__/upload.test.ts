import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { TikTokApiError } from "../client.ts";
import {
  bytesToStream,
  hashStreamMd5,
  logTikTokUploadTiming,
  md5Hex,
  SMART_FIX_OFF,
  smartFixFieldsForMode,
  uniqueTikTokFileName,
  uploadTikTokAdVideo,
  type TikTokFileUploadSource,
  type TikTokUploadTransport,
} from "../upload.ts";

const TOKEN = "secret-token-should-never-appear";
const SIGNED_URL =
  "https://example.supabase.co/storage/v1/object/sign/campaign-assets/videos/x.mp4?token=signed-secret";

function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

function fileSource(bytes: Uint8Array, mimeType = "video/mp4"): TikTokFileUploadSource {
  return {
    kind: "file",
    signature: md5Hex(bytes),
    mimeType,
    byteLength: bytes.byteLength,
    open: async () => bytesToStream(bytes),
  };
}

async function readBody(body: BodyInit): Promise<Uint8Array> {
  assert.ok(body instanceof ReadableStream);
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe("uniqueTikTokFileName", () => {
  it("suffixes a timestamp and stays within 100 chars", () => {
    const name = uniqueTikTokFileName("house anthem.mp4", 1_700_000_000_000);
    assert.match(name, /^house_anthem-[a-z0-9]+\.mp4$/);
    assert.ok(name.length <= 100);
  });
});

describe("smartFixFieldsForMode", () => {
  it("is identical in source and omits FILE multipart booleans", () => {
    assert.equal(smartFixFieldsForMode("UPLOAD_BY_FILE"), null);
    assert.deepEqual(smartFixFieldsForMode("UPLOAD_BY_URL"), { ...SMART_FIX_OFF });
    assert.equal(SMART_FIX_OFF.flaw_detect, false);
    assert.equal(SMART_FIX_OFF.auto_fix_enabled, false);
    assert.equal(SMART_FIX_OFF.auto_bind_enabled, false);
  });
});

describe("uploadTikTokAdVideo", () => {
  it("UPLOAD_BY_FILE streams multipart with the pass-1 signature and no Smart Fix fields", async () => {
    const bytes = new TextEncoder().encode("video-bytes");
    const expectedSignature = md5("video-bytes");
    let sawStream = false;
    const transport: TikTokUploadTransport = async (request) => {
      assert.match(request.url, /\/file\/video\/ad\/upload\/$/);
      assert.equal(request.headers["Access-Token"], TOKEN);
      assert.match(request.headers["Content-Type"] ?? "", /^multipart\/form-data; boundary=/);
      assert.equal(request.duplex, "half");
      assert.ok(request.body instanceof ReadableStream);
      sawStream = true;
      const raw = new TextDecoder().decode(await readBody(request.body));
      assert.match(raw, new RegExp(`name="video_signature"\\r\\n\\r\\n${expectedSignature}`));
      assert.match(raw, /name="video_file"/);
      assert.doesNotMatch(raw, /flaw_detect/);
      assert.doesNotMatch(raw, /auto_fix_enabled/);
      assert.doesNotMatch(raw, /auto_bind_enabled/);
      return {
        status: 200,
        json: {
          code: 0,
          message: "ok",
          data: [
            {
              video_id: "v-file",
              preview_url: "https://cdn.example/preview.jpg",
              width: 1080,
              height: 1920,
              duration: 12,
            },
          ],
        },
      };
    };

    const result = await uploadTikTokAdVideo({
      advertiserId: "adv-1",
      token: TOKEN,
      mode: "UPLOAD_BY_FILE",
      source: fileSource(bytes),
      fileName: "clip.mp4",
      transport,
      sleep: async () => {},
    });
    assert.equal(result.videoId, "v-file");
    assert.equal(result.previewUrl, "https://cdn.example/preview.jpg");
    assert.equal(sawStream, true);
    const hashed = await hashStreamMd5(bytesToStream(bytes));
    assert.equal(hashed.signature, expectedSignature);
    assert.equal(hashed.bytes, bytes.byteLength);
  });

  it("UPLOAD_BY_URL sends JSON with video_url and Smart Fix false booleans", async () => {
    const transport: TikTokUploadTransport = async (request) => {
      assert.equal(request.headers["Content-Type"], "application/json");
      const body = JSON.parse(String(request.body)) as Record<string, unknown>;
      assert.equal(body.upload_type, "UPLOAD_BY_URL");
      assert.equal(body.video_url, SIGNED_URL);
      assert.deepEqual(
        {
          flaw_detect: body.flaw_detect,
          auto_fix_enabled: body.auto_fix_enabled,
          auto_bind_enabled: body.auto_bind_enabled,
        },
        SMART_FIX_OFF,
      );
      return {
        status: 200,
        json: { code: 0, data: [{ video_id: "v-url", duration: 9 }] },
      };
    };

    const result = await uploadTikTokAdVideo({
      advertiserId: "adv-1",
      token: TOKEN,
      mode: "UPLOAD_BY_URL",
      source: { kind: "url", videoUrl: SIGNED_URL },
      fileName: "clip.mp4",
      bytes: 15_000_000,
      transport,
      sleep: async () => {},
    });
    assert.equal(result.videoId, "v-url");
  });

  it("accepts a video_id-only response and backfills info", async () => {
    let infoCalls = 0;
    const transport: TikTokUploadTransport = async () => ({
      status: 200,
      json: { code: 0, data: [{ video_id: "v-late" }] },
    });
    const result = await uploadTikTokAdVideo({
      advertiserId: "adv-1",
      token: TOKEN,
      mode: "UPLOAD_BY_FILE",
      source: fileSource(new Uint8Array([1, 2, 3])),
      fileName: "late.mp4",
      transport,
      sleep: async () => {},
      infoRequest: async () => {
        infoCalls += 1;
        return [
          {
            video_id: "v-late",
            thumbnail_url: "https://cdn.example/late.jpg",
            duration_seconds: 18,
            title: "late",
          },
        ];
      },
    });
    assert.equal(result.videoId, "v-late");
    assert.equal(result.previewUrl, "https://cdn.example/late.jpg");
    assert.equal(result.durationSeconds, 18);
    assert.equal(result.backfilled, true);
    assert.equal(infoCalls, 1);
  });

  it("retries once with a new suffix on a duplicate-name error", async () => {
    const names: string[] = [];
    let calls = 0;
    const transport: TikTokUploadTransport = async (request) => {
      calls += 1;
      const raw = new TextDecoder().decode(await readBody(request.body));
      const match = raw.match(/name="file_name"\r\n\r\n([^\r]+)/);
      names.push(match?.[1] ?? "");
      if (calls === 1) {
        return {
          status: 400,
          json: { message: "file name already exists" },
        };
      }
      return {
        status: 200,
        json: { code: 0, data: [{ video_id: "v-retry", duration: 4 }] },
      };
    };

    const result = await uploadTikTokAdVideo({
      advertiserId: "adv-1",
      token: TOKEN,
      mode: "UPLOAD_BY_FILE",
      source: fileSource(new Uint8Array([9])),
      fileName: "same.mp4",
      transport,
      sleep: async () => {},
    });
    assert.equal(result.videoId, "v-retry");
    assert.equal(names.length, 2);
    assert.notEqual(names[0], names[1]);
  });

  it("returns a clear error for an unknown response shape instead of throwing", async () => {
    await assert.rejects(
      () =>
        uploadTikTokAdVideo({
          advertiserId: "adv-1",
          token: TOKEN,
          mode: "UPLOAD_BY_FILE",
          source: fileSource(new Uint8Array([1])),
          fileName: "odd.mp4",
          transport: async () => ({
            status: 200,
            json: { code: 0, data: { unexpected: true } },
          }),
          sleep: async () => {},
        }),
      (error: unknown) => {
        assert.ok(error instanceof TikTokApiError);
        assert.match(error.message, /no video_id/);
        assert.match(error.message, /keys=\[code,data\]/);
        assert.match(error.message, /rowKeys=\[unexpected\]/);
        return true;
      },
    );
  });

  it("a timed-out upload yields outcome=timeout with bytes and elapsedMs", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await assert.rejects(
        () =>
          uploadTikTokAdVideo({
            advertiserId: "adv-1",
            token: TOKEN,
            mode: "UPLOAD_BY_URL",
            source: { kind: "url", videoUrl: SIGNED_URL },
            fileName: "slow.mp4",
            bytes: 15_728_640,
            timeoutMs: 20,
            transport: async (request) =>
              new Promise((_, reject) => {
                request.signal.addEventListener("abort", () => {
                  reject(new DOMException("The operation was aborted.", "AbortError"));
                });
              }),
            sleep: async () => {},
          }),
        (error: unknown) => {
          assert.ok(error instanceof TikTokApiError);
          assert.match(error.message, /timeout/);
          assert.match(error.message, /15\.0 MB/);
          return true;
        },
      );
    } finally {
      console.error = original;
    }
    assert.match(
      lines.join("\n"),
      /\[tiktok\/upload\] mode=UPLOAD_BY_URL advertiser=adv-1 bytes=15728640 elapsedMs=\d+ outcome=timeout/,
    );
  });

  it("upload logs contain no token and no signed URL", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await uploadTikTokAdVideo({
        advertiserId: "adv-1",
        token: TOKEN,
        mode: "UPLOAD_BY_URL",
        source: { kind: "url", videoUrl: SIGNED_URL },
        fileName: "clip.mp4",
        bytes: 15_000_000,
        transport: async () => ({
          status: 200,
          json: { code: 0, data: [{ video_id: "v-log", duration: 3 }] },
        }),
        sleep: async () => {},
      });
    } finally {
      console.error = original;
    }
    const joined = lines.join("\n");
    assert.match(joined, /\[tiktok\/upload\] mode=UPLOAD_BY_URL/);
    assert.doesNotMatch(joined, /secret-token-should-never-appear/);
    assert.doesNotMatch(joined, /signed-secret/);
    assert.doesNotMatch(joined, /video_url=/);
  });

  it("timing log contains no token and no signed URL", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      logTikTokUploadTiming({
        mode: "UPLOAD_BY_URL",
        advertiserId: "adv-1",
        bytes: 15_728_640,
        elapsedMs: 8421,
        outcome: "ok",
        code: 0,
      });
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /\[tiktok\/upload\] mode=UPLOAD_BY_URL advertiser=adv-1 bytes=15728640 elapsedMs=8421 outcome=ok code=0/,
    );
    assert.doesNotMatch(lines[0], /secret-token/);
    assert.doesNotMatch(lines[0], /signed-secret/);
    assert.doesNotMatch(lines[0], /supabase\.co/);
  });
});
