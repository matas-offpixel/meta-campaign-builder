import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  findAssetByFingerprint,
  findChannelId,
  fingerprintBytes,
  recordChannelId,
  resolveRegistryAspect,
  upsertRegisteredAsset,
  type ContentIdentity,
} from "../asset-registry.ts";

function memoryRegistry() {
  const assets = new Map<string, Record<string, unknown>>();
  const channels = new Map<string, Record<string, unknown>>();

  function keyForAsset(row: Record<string, unknown>) {
    return `${row.user_id}:${row.content_hash}:${row.byte_size}`;
  }
  function keyForChannel(row: Record<string, unknown>) {
    return `${row.asset_id}:${row.channel}:${row.scope}`;
  }

  function store(table: string) {
    return table === "creative_assets" ? assets : channels;
  }

  return {
    assets,
    channels,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, value: unknown) {
          filters.push([col, value]);
          return chain;
        },
        in() {
          return chain;
        },
        maybeSingle: async () => {
          const rows = [...store(table).values()].filter((row) =>
            filters.every(([col, value]) => row[col] === value),
          );
          return { data: rows[0] ?? null, error: null };
        },
        upsert(row: Record<string, unknown>) {
          const map = store(table);
          const key = table === "creative_assets" ? keyForAsset(row) : keyForChannel(row);
          if (!map.has(key)) {
            const id = (row.id as string) || `id-${map.size + 1}`;
            const written = {
              ...row,
              id,
              created_at: "2026-08-26T12:00:00.000Z",
            };
            map.set(key, written);
            return {
              select: () => ({
                maybeSingle: async () => ({ data: written, error: null }),
              }),
            };
          }
          const existing = map.get(key)!;
          return {
            select: () => ({
              maybeSingle: async () => ({ data: existing, error: null }),
            }),
          };
        },
      };
      return chain;
    },
  };
}

const USER = "user-1";
const BYTES_A = Buffer.from("parable-spot-v1");
const BYTES_B = Buffer.from("parable-spot-v2");

function identity(bytes: Buffer): ContentIdentity {
  return fingerprintBytes(bytes);
}

function registerInput(bytes: Buffer, extras: { filename?: string; existingId?: string } = {}) {
  const id = identity(bytes);
  return {
    userId: USER,
    identity: id,
    filename: extras.filename ?? "Parable 9x16.mp4",
    mediaKind: "video" as const,
    aspectRatio: "9:16" as const,
    storageBucket: "campaign-assets",
    storagePath: `videos/${id.contentHash}.mp4`,
    existingId: extras.existingId,
  };
}

describe("fingerprintBytes", () => {
  it("is deterministic for the same bytes and changes when bytes change", () => {
    const a = fingerprintBytes(BYTES_A);
    const b = fingerprintBytes(Buffer.from("parable-spot-v1"));
    const c = fingerprintBytes(BYTES_B);
    assert.equal(a.contentHash, b.contentHash);
    assert.equal(a.byteSize, BYTES_A.byteLength);
    assert.notEqual(a.contentHash, c.contentHash);
  });
});

describe("dedupe — same bytes re-uploaded → one registry row", () => {
  it("upserts once and a second write of the same bytes is a no-create", async () => {
    const db = memoryRegistry();
    const first = await upsertRegisteredAsset(db, registerInput(BYTES_A));
    const second = await upsertRegisteredAsset(db, registerInput(BYTES_A, { filename: "copy.mp4" }));
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.asset.id, second.asset.id);
    assert.equal(db.assets.size, 1);
    const found = await findAssetByFingerprint(db, USER, identity(BYTES_A));
    assert.equal(found.ok && found.asset?.id, first.asset.id);
  });

  it("different bytes get a second row", async () => {
    const db = memoryRegistry();
    await upsertRegisteredAsset(db, registerInput(BYTES_A));
    await upsertRegisteredAsset(db, registerInput(BYTES_B));
    assert.equal(db.assets.size, 2);
  });
});

describe("channel-id at-most-once", () => {
  it("keeps the first platform id and refuses a second write for the same scope", async () => {
    const db = memoryRegistry();
    const asset = await upsertRegisteredAsset(db, registerInput(BYTES_A));
    assert.equal(asset.ok, true);
    if (!asset.ok) return;
    const first = await recordChannelId(db, {
      assetId: asset.asset.id,
      userId: USER,
      channel: "tiktok",
      scope: "adv-1",
      platformId: "tt_video_1",
    });
    const second = await recordChannelId(db, {
      assetId: asset.asset.id,
      userId: USER,
      channel: "tiktok",
      scope: "adv-1",
      platformId: "tt_video_SHOULD_NOT_WIN",
    });
    assert.equal(first.ok && first.wrote, true);
    assert.equal(second.ok && second.wrote, false);
    if (!second.ok) return;
    assert.equal(second.platformId, "tt_video_1");
    const lookup = await findChannelId(db, {
      assetId: asset.asset.id,
      userId: USER,
      channel: "tiktok",
      scope: "adv-1",
    });
    assert.equal(lookup.ok && lookup.platformId, "tt_video_1");
    assert.equal(db.channels.size, 1);
  });

  it("allows the same asset on a second advertiser", async () => {
    const db = memoryRegistry();
    const asset = await upsertRegisteredAsset(db, registerInput(BYTES_A));
    assert.ok(asset.ok);
    if (!asset.ok) return;
    await recordChannelId(db, {
      assetId: asset.asset.id,
      userId: USER,
      channel: "tiktok",
      scope: "adv-1",
      platformId: "tt_1",
    });
    await recordChannelId(db, {
      assetId: asset.asset.id,
      userId: USER,
      channel: "tiktok",
      scope: "adv-2",
      platformId: "tt_2",
    });
    assert.equal(db.channels.size, 2);
  });
});

describe("aspect detection reuses #584", () => {
  it("snaps 9x16 filenames and falls back to a slot hint", () => {
    assert.equal(resolveRegistryAspect({ filename: "Parable 9x16.mp4" }), "9:16");
    assert.equal(resolveRegistryAspect({ filename: "feed.jpg", slotHint: "4:5" }), "4:5");
    assert.equal(resolveRegistryAspect({ filename: "mystery.bin" }), "other");
  });
});

describe("migration 161", () => {
  const sql = readFileSync("supabase/migrations/161_creative_asset_registry.sql", "utf8");

  it("declares the registry, channel ids, and plan routes without applying language", () => {
    assert.match(sql, /create table if not exists creative_assets/);
    assert.match(sql, /unique \(user_id, content_hash, byte_size\)/);
    assert.match(sql, /create table if not exists creative_asset_channel_ids/);
    assert.match(sql, /unique \(asset_id, channel, scope\)/);
    assert.match(sql, /create table if not exists campaign_plan_asset_routes/);
    assert.match(sql, /auth.uid\(\) = user_id/);
    assert.match(sql, /Do not apply in this run/);
    assert.doesNotMatch(sql, /insert into creative_assets/i);
  });
});
