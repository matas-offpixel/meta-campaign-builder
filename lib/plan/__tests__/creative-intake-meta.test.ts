/**
 * Send copies a stored image with a storage client that can read the
 * bucket, then asks the upload route for a Meta hash.
 *
 * Run: node --test.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { upgradeRegisteredAspect } from "../../creatives/asset-registry.ts";
import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { deliverIntakeAssetsToMeta, type MetaUploadStorage } from "../creative-intake-meta.ts";
import type { CampaignDraft } from "../../types.ts";

const GRID = "images/mml-201cffc4-1bcd-46c3-8167-13348c2173bd-grid.jpg";
const STORY = "images/mml-c41ac78a-8b2a-4831-91ec-6e1e55781400-story.jpg";

function creative(id: string, filename: string, storagePath: string, registryId: string): CampaignDraft["creatives"][number] {
  const row = createDefaultCreative();
  const asset = row.assetVariations[0]?.assets[0];
  if (!asset) throw new Error("default creative has no asset");
  return {
    ...row,
    id,
    name: filename.replace(/\.jpg$/, ""),
    assetVariations: [{
      ...row.assetVariations[0]!,
      assets: [{
        ...asset,
        id: `${id}-asset`,
        registryAssetId: registryId,
        storagePath,
        storageBucket: "campaign-assets",
        fileName: filename,
        uploadStatus: "pending",
      }],
    }],
  };
}

describe("Send two stored images", () => {
  it("produces Meta hashes and does not ask the session client for the object", async () => {
    const copies: Array<{ from: string; to: string }> = [];
    let removed = 0;
    const storage: MetaUploadStorage = {
      copy: async (from, to) => {
        copies.push({ from, to });
        return { error: null };
      },
      remove: async () => {
        removed += 1;
      },
    };
    const asked: Array<{ bucket: string; path: string; type: string }> = [];
    const upload = async (request: Request) => {
      const before = removed;
      const body = (await request.json()) as { storageBucket: string; storagePath: string; type: string; fileName: string };
      assert.equal(removed, before, "the copy is still there while Meta reads it");
      asked.push({ bucket: body.storageBucket, path: body.storagePath, type: body.type });
      const hash = body.fileName === "Grid.jpg" ? "hash-grid" : "hash-story";
      return Response.json({ hash }, { status: 201 });
    };
    const draft = createDefaultDraft();
    draft.creatives = [
      creative("grid", "Grid.jpg", GRID, "reg-grid"),
      creative("story", "Story.jpg", STORY, "reg-story"),
    ];
    const progress: string[] = [];
    const uploaded = await deliverIntakeAssetsToMeta({
      draft,
      creativeIds: new Set(["grid", "story"]),
      assetsById: new Map([
        ["reg-grid", { id: "reg-grid", filename: "Grid.jpg", mediaKind: "image", contentHash: "a".repeat(64), byteSize: 10, storagePath: GRID, aspectRatio: "4:5" }],
        ["reg-story", { id: "reg-story", filename: "Story.jpg", mediaKind: "image", contentHash: "b".repeat(64), byteSize: 10, storagePath: STORY, aspectRatio: "9:16" }],
      ]),
      adAccountId: "act_1",
      channelPlatformId: () => null,
      storage,
      upload,
      onUpload: (event) => progress.push(`Uploading ${event.index} of ${event.total}…`),
    });
    assert.deepEqual(copies.map((row) => row.from), [GRID, STORY]);
    assert.deepEqual(asked.map((row) => row.bucket), ["campaign-assets", "campaign-assets"]);
    assert.equal(asked.every((row) => /^images\/mml-[0-9a-f-]+-meta-upload$/.test(row.path)), true);
    assert.equal(removed, 2);
    assert.deepEqual(progress, ["Uploading 1 of 2…", "Uploading 2 of 2…"]);
    const hashes = uploaded.draft.creatives.flatMap((row) => row.assetVariations.flatMap((variation) => variation.assets.map((asset) => asset.assetHash)));
    assert.deepEqual(hashes, ["hash-grid", "hash-story"]);
    const errors = uploaded.draft.creatives.flatMap((row) => row.assetVariations.flatMap((variation) => variation.assets.map((asset) => asset.error)));
    assert.equal(errors.every((error) => error == null), true);
    assert.equal(JSON.stringify(uploaded.draft).includes("Object not found"), false);

    const server = readFileSync("lib/plan/creative-intake-server.ts", "utf8");
    assert.match(server, /serviceRoleStorage\(\)/);
    assert.doesNotMatch(server, /storageOf\(supabase\)\.from\(BUCKET\)\.copy/);
  });

  it("surfaces the session client's Object not found when that client is the one asked to copy", async () => {
    const storage: MetaUploadStorage = {
      copy: async () => ({ error: { message: "Object not found" } }),
      remove: async () => undefined,
    };
    let called = false;
    const result = await deliverIntakeAssetsToMeta({
      draft: (() => {
        const draft = createDefaultDraft();
        draft.creatives = [creative("grid", "Grid.jpg", GRID, "reg-grid")];
        return draft;
      })(),
      creativeIds: new Set(["grid"]),
      assetsById: new Map([
        ["reg-grid", { id: "reg-grid", filename: "Grid.jpg", mediaKind: "image", contentHash: "a".repeat(64), byteSize: 10, storagePath: GRID, aspectRatio: "4:5" }],
      ]),
      adAccountId: "act_1",
      channelPlatformId: () => null,
      storage,
      upload: async () => {
        called = true;
        return Response.json({ hash: "nope" }, { status: 201 });
      },
    });
    assert.equal(called, false);
    assert.equal(uploadedError(result.draft), "Object not found");
  });
});

function uploadedError(draft: CampaignDraft): string | undefined {
  return draft.creatives[0]?.assetVariations[0]?.assets[0]?.error;
}

describe("registry aspect upgrade", () => {
  it("writes a standard ratio only where the row is other or null", async () => {
    let filter = "";
    let written = "";
    const supabase = {
      from: () => ({
        update: (row: { aspect_ratio: string }) => ({
          eq: () => ({
            eq: () => ({
              or: async (value: string) => {
                written = row.aspect_ratio;
                filter = value;
                return { error: null };
              },
            }),
          }),
        }),
      }),
    };
    const saved = await upgradeRegisteredAspect(supabase, {
      assetId: "reg-1",
      userId: "user-1",
      aspectRatio: "9:16",
    });
    assert.equal(saved.ok, true);
    assert.equal(written, "9:16");
    assert.match(filter, /aspect_ratio\.eq\.other/);
    assert.match(filter, /aspect_ratio\.is\.null/);
  });
});
