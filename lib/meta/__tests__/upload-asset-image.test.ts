import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleUploadAsset, type UploadAssetHooks } from "../upload-asset-handler.ts";

const USER_MSG = "We could not process the image that you have uploaded. Please try again or upload a different image.";

class MetaApiError extends Error {
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly userMsg: string | undefined;

  constructor(message: string, code?: number, subcode?: number, userMsg?: string) {
    super(message);
    this.name = "MetaApiError";
    this.code = code;
    this.subcode = subcode;
    this.userMsg = userMsg;
  }

  toJSON(): Record<string, unknown> {
    return {
      error: this.message,
      code: this.code,
      error_subcode: this.subcode,
      error_user_msg: this.userMsg,
    };
  }
}

function jpegFile(name = "shot.jpg"): File {
  return new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], name, { type: "image/jpeg" });
}

function hooks(overrides: Partial<UploadAssetHooks> = {}): UploadAssetHooks & {
  removed: string[][];
  persisted: string[];
  uploadedNames: string[];
} {
  const removed: string[][] = [];
  const persisted: string[] = [];
  const uploadedNames: string[] = [];
  const base: UploadAssetHooks = {
    getUser: async () => ({ id: "user-1" }),
    resolveToken: async () => ({ token: "tok", source: "test" }),
    supabase: {},
    storage: {
      createSignedUrl: async () => ({ signedUrl: "https://storage.example/object" }),
      remove: async (_bucket, paths) => {
        removed.push(paths);
      },
    },
    download: async () => jpegFile(),
    findExisting: async () => null,
    uploadImage: async (_adAccountId, file) => {
      const named = file as File;
      uploadedNames.push(named.name ?? "blob");
      return { hash: "img_hash", url: "https://cdn.example/img.jpg" };
    },
    uploadVideo: async () => {
      throw new Error("video upload should not run for an image");
    },
    register: async () => "reg-1",
    persist: async (storagePath) => {
      persisted.push(storagePath);
      return { error: null };
    },
  };
  return { ...base, ...overrides, removed, persisted, uploadedNames };
}

function storageRequest(): Request {
  return new Request("http://localhost/api/meta/upload-asset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      storagePath: "images/shot.jpg",
      storageBucket: "campaign-assets",
      type: "image",
      adAccountId: "act_1967530076312",
      fileName: "JJ - GA SELL OUT THURSDAY V3.jpg",
      contentType: "image/jpeg",
    }),
  });
}

function formRequest(): Request {
  const body = new FormData();
  body.set("file", jpegFile("reel.jpg"));
  body.set("type", "image");
  body.set("adAccountId", "act_1967530076312");
  body.set("aspectRatio", "9:16");
  return new Request("http://localhost/api/meta/upload-asset", { method: "POST", body });
}

describe("image upload paths", () => {
  it("storage path uploads a plain JPEG and returns 201 without contentHash", async () => {
    const h = hooks();
    const res = await handleUploadAsset(storageRequest(), h);
    const json = await res.json();
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
    assert.equal(json.hash, "img_hash");
    assert.equal(json.assetType, "image");
    assert.equal(json.registryAssetId, "reg-1");
    assert.equal(h.uploadedNames.length, 1);
    assert.equal(h.removed.length, 0);
  });

  it("storage path turns a Meta image rejection into JSON, not an empty 500", async () => {
    const h = hooks({
      uploadImage: async () => {
        throw new MetaApiError("Invalid parameter", 100, 2446496, USER_MSG);
      },
    });
    const res = await handleUploadAsset(storageRequest(), h);
    const text = await res.text();
    assert.notEqual(text.length, 0);
    const json = JSON.parse(text) as { error: string; error_subcode?: number };
    assert.equal(res.status, 502);
    assert.equal(json.error, USER_MSG);
    assert.equal(json.error_subcode, 2446496);
    assert.deepEqual(h.removed, [["images/shot.jpg"]]);
  });

  it("FormData path uploads a plain JPEG and returns 201", async () => {
    const h = hooks();
    const res = await handleUploadAsset(formRequest(), h);
    const json = await res.json();
    assert.equal(res.status, 201);
    assert.equal(json.hash, "img_hash");
    assert.equal(json.assetType, "image");
    assert.equal(h.persisted.length, 1);
    assert.match(h.persisted[0], /^images\/.+\.jpg$/);
  });

  it("FormData path turns a Meta image rejection into JSON and does not persist", async () => {
    const h = hooks({
      uploadImage: async () => {
        throw new MetaApiError(USER_MSG, 100, 2446496, USER_MSG);
      },
    });
    const res = await handleUploadAsset(formRequest(), h);
    const json = await res.json();
    assert.equal(res.status, 502);
    assert.equal(json.error, USER_MSG);
    assert.equal(h.persisted.length, 0);
  });

  it("a non-Meta throw on the storage image path is JSON 500 with the message", async () => {
    const h = hooks({
      uploadImage: async () => {
        throw new Error("storage client exploded");
      },
    });
    const res = await handleUploadAsset(storageRequest(), h);
    const json = await res.json();
    assert.equal(res.status, 500);
    assert.equal(json.error, "storage client exploded");
    assert.deepEqual(h.removed, [["images/shot.jpg"]]);
  });

  it("a throw outside the image try still returns JSON", async () => {
    const h = hooks({
      findExisting: async () => {
        throw new Error("registry unavailable");
      },
    });
    const res = await handleUploadAsset(storageRequest(), h);
    const json = await res.json();
    assert.equal(res.status, 500);
    assert.equal(json.error, "registry unavailable");
  });
});
