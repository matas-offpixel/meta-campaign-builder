import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { TikTokApiError } from "../client.ts";
import {
  logTikTokUploadTiming,
  md5Hex,
  uniqueTikTokFileName,
  uploadTikTokAdVideo,
  type TikTokUploadTransport,
} from "../upload.ts";

const TOKEN = "secret-token-should-never-appear";
const SIGNED_URL =
  "https://example.supabase.co/storage/v1/object/sign/campaign-assets/videos/x.mp4?token=signed-secret";

function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

describe("uniqueTikTokFileName", () => {
  it("suffixes a timestamp and stays within 100 chars", () => {
    const name = uniqueTikTokFileName("house anthem.mp4", 1_700_000_000_000);
    assert.match(name, /^house_anthem-[a-z0-9]+\.mp4$/);
    assert.ok(name.length <= 100);
  });
});

describe("uploadTikTokAdVideo", () => {
  it("UPLOAD_BY_FILE sends multipart with video_file, md5 signature, and Smart Fix off", async () => {
    const bytes = new TextEncoder().encode("video-bytes");
    let sawFile = false;
    const transport: TikTokUploadTransport = async (request) => {
      assert.match(request.url, /\/file\/video\/ad\/upload\/$/);
      assert.equal(request.headers["Access-Token"], TOKEN);
      assert.equal(request.headers["Content-Type"], undefined);
      assert.ok(request.body instanceof FormData);
      const form = request.body;
      assert.equal(form.get("advertiser_id"), "adv-1");
      assert.equal(form.get("upload_type"), "UPLOAD_BY_FILE");
      assert.equal(form.get("video_signature"), md5("video-bytes"));
      assert.equal(form.get("flaw_detect"), "false");
      assert.equal(form.get("auto_fix_enabled"), "false");
      assert.equal(form.get("auto_bind_enabled"), "false");
      const file = form.get("video_file");
      assert.ok(file instanceof Blob);
      sawFile = true;
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
      source: { kind: "file", bytes, mimeType: "video/mp4" },
      fileName: "clip.mp4",
      transport,
      sleep: async () => {},
    });
    assert.equal(result.videoId, "v-file");
    assert.equal(result.previewUrl, "https://cdn.example/preview.jpg");
    assert.equal(sawFile, true);
    assert.equal(md5Hex(bytes), md5("video-bytes"));
  });

  it("UPLOAD_BY_URL sends JSON with video_url and Smart Fix false booleans", async () => {
    const transport: TikTokUploadTransport = async (request) => {
      assert.equal(request.headers["Content-Type"], "application/json");
      const body = JSON.parse(String(request.body)) as Record<string, unknown>;
      assert.equal(body.upload_type, "UPLOAD_BY_URL");
      assert.equal(body.video_url, SIGNED_URL);
      assert.equal(body.flaw_detect, false);
      assert.equal(body.auto_fix_enabled, false);
      assert.equal(body.auto_bind_enabled, false);
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
      source: { kind: "file", bytes: new Uint8Array([1, 2, 3]), mimeType: "video/mp4" },
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
      const form = request.body as FormData;
      names.push(String(form.get("file_name")));
      if (calls === 1) {
        return {
          status: 200,
          json: { code: 40900, message: "file name already exists" },
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
      source: { kind: "file", bytes: new Uint8Array([9]), mimeType: "video/mp4" },
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
          source: { kind: "file", bytes: new Uint8Array([1]), mimeType: "video/mp4" },
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
        assert.match(error.message, /keys=\[/);
        return true;
      },
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
