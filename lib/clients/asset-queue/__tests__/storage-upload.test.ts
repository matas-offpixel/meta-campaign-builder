/**
 * Tests for storage-upload.ts — TUS resumable + simple upload paths.
 *
 * The threshold logic, TUS HTTP flow (POST create → PATCH data), and error
 * handling are covered. The simple-upload path delegates to the Supabase
 * storage-js client (mocked via serviceClient stub).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  RESUMABLE_UPLOAD_THRESHOLD,
  uploadResumableTus,
  uploadToStorageBucket,
} from "../storage-upload.ts";

// ── env setup ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = "https://example.supabase.co";
const SERVICE_KEY = "service-role-key-test";

function setEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
}

function clearEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// ── fetch mock helpers ─────────────────────────────────────────────────────────

type FakeResponse = {
  status: number;
  headers?: Record<string, string>;
  text?: string;
};

function makeFakeResponse({ status, headers = {}, text = "" }: FakeResponse): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text: async () => text,
  } as unknown as Response;
}

// ── stub Supabase serviceClient ────────────────────────────────────────────────

function makeServiceClient(uploadResult: { error: { message: string } | null }) {
  return {
    storage: {
      from: (_bucket: string) => ({
        upload: async () => uploadResult,
      }),
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const MB = 1024 * 1024;

afterEach(() => {
  mock.restoreAll();
  clearEnv();
});

// ── uploadResumableTus ─────────────────────────────────────────────────────────

describe("uploadResumableTus", () => {
  it("returns error when env vars are missing", async () => {
    clearEnv();
    const { error } = await uploadResumableTus(
      "campaign-assets",
      "queue/q1/video.mp4",
      Buffer.alloc(10),
      "video/mp4",
    );
    assert.ok(error);
    assert.match(error.message, /missing/i);
  });

  it("successful TUS: POST 201 → PATCH 204 → error null", async () => {
    setEnv();

    let callCount = 0;
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      callCount += 1;
      if (callCount === 1) {
        // POST create
        assert.equal(init?.method, "POST");
        assert.ok((url as string).includes("/storage/v1/upload/resumable"));
        assert.equal(
          (init?.headers as Record<string, string>)["Tus-Resumable"],
          "1.0.0",
        );
        return makeFakeResponse({
          status: 201,
          headers: { Location: "/storage/v1/upload/resumable?uploadId=abc123" },
        });
      }
      // PATCH upload
      assert.equal(init?.method, "PATCH");
      assert.ok((url as string).includes("uploadId=abc123"));
      assert.equal(
        (init?.headers as Record<string, string>)["Upload-Offset"],
        "0",
      );
      return makeFakeResponse({ status: 204 });
    });

    const buf = Buffer.alloc(50 * MB);
    const { error } = await uploadResumableTus(
      "campaign-assets",
      "queue/q1/presenter.mp4",
      buf,
      "video/mp4",
    );
    assert.equal(error, null);
    assert.equal(callCount, 2);
  });

  it("returns error when TUS create returns non-201", async () => {
    setEnv();
    mock.method(globalThis, "fetch", async () =>
      makeFakeResponse({ status: 500, text: "Internal Server Error" }),
    );

    const { error } = await uploadResumableTus(
      "campaign-assets",
      "queue/q1/video.mp4",
      Buffer.alloc(10),
      "video/mp4",
    );
    assert.ok(error);
    assert.match(error.message, /TUS create failed: HTTP 500/);
  });

  it("returns error when TUS create has no Location header", async () => {
    setEnv();
    mock.method(globalThis, "fetch", async () =>
      makeFakeResponse({ status: 201 }),
    );

    const { error } = await uploadResumableTus(
      "campaign-assets",
      "queue/q1/video.mp4",
      Buffer.alloc(10),
      "video/mp4",
    );
    assert.ok(error);
    assert.match(error.message, /Location/);
  });

  it("returns error when TUS PATCH returns non-204", async () => {
    setEnv();
    let call = 0;
    mock.method(globalThis, "fetch", async () => {
      call += 1;
      if (call === 1) {
        return makeFakeResponse({
          status: 201,
          headers: { Location: "/storage/v1/upload/resumable?uploadId=xyz" },
        });
      }
      return makeFakeResponse({ status: 413, text: "Payload Too Large" });
    });

    const { error } = await uploadResumableTus(
      "campaign-assets",
      "queue/q1/video.mp4",
      Buffer.alloc(10),
      "video/mp4",
    );
    assert.ok(error);
    assert.match(error.message, /TUS PATCH failed: HTTP 413/);
  });

  it("sends x-upsert: true on the create request", async () => {
    setEnv();
    let capturedHeaders: Record<string, string> = {};
    let call = 0;
    mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return makeFakeResponse({
          status: 201,
          headers: { Location: `${SUPABASE_URL}/storage/v1/upload/resumable?id=1` },
        });
      }
      return makeFakeResponse({ status: 204 });
    });

    await uploadResumableTus("campaign-assets", "q/f.mp4", Buffer.alloc(1), "video/mp4");
    assert.equal(capturedHeaders["x-upsert"], "true");
  });
});

// ── uploadToStorageBucket ─────────────────────────────────────────────────────

describe("uploadToStorageBucket", () => {
  it("uses simple upload for files ≤ 40 MB", async () => {
    const client = makeServiceClient({ error: null });
    const buf = Buffer.alloc(30 * MB);
    const { error } = await uploadToStorageBucket(
      client,
      "campaign-assets",
      "queue/q2/image.jpg",
      buf,
      "image/jpeg",
    );
    assert.equal(error, null);
  });

  it("simple upload propagates storage error", async () => {
    const client = makeServiceClient({ error: { message: "bucket not found" } });
    const buf = Buffer.alloc(1 * MB);
    const { error } = await uploadToStorageBucket(
      client,
      "campaign-assets",
      "queue/q3/img.png",
      buf,
      "image/png",
    );
    assert.ok(error);
    assert.equal((error as { message: string }).message, "bucket not found");
  });

  it("uses TUS for files > 40 MB (threshold boundary)", async () => {
    setEnv();
    let tusCalled = false;
    mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        tusCalled = true;
        return makeFakeResponse({
          status: 201,
          headers: { Location: `${SUPABASE_URL}/storage/v1/upload/resumable?id=2` },
        });
      }
      return makeFakeResponse({ status: 204 });
    });

    const buf = Buffer.alloc(RESUMABLE_UPLOAD_THRESHOLD + 1);
    const client = makeServiceClient({ error: null });
    const { error } = await uploadToStorageBucket(
      client,
      "campaign-assets",
      "queue/q4/video.mp4",
      buf,
      "video/mp4",
    );
    assert.equal(error, null);
    assert.equal(tusCalled, true, "Expected TUS path to be taken for large file");
  });

  it("does NOT use TUS for files exactly at threshold", async () => {
    const client = makeServiceClient({ error: null });
    const buf = Buffer.alloc(RESUMABLE_UPLOAD_THRESHOLD); // exactly 40 MB — simple path
    let fetchCalled = false;
    mock.method(globalThis, "fetch", async () => {
      fetchCalled = true;
      return makeFakeResponse({ status: 201, headers: { Location: "/" } });
    });

    const { error } = await uploadToStorageBucket(
      client,
      "campaign-assets",
      "queue/q5/video.mp4",
      buf,
      "video/mp4",
    );
    assert.equal(error, null);
    assert.equal(fetchCalled, false, "fetch should not be called for ≤ threshold file");
  });
});

describe("RESUMABLE_UPLOAD_THRESHOLD", () => {
  it("is 40 MB", () => {
    assert.equal(RESUMABLE_UPLOAD_THRESHOLD, 40 * 1024 * 1024);
  });
});
