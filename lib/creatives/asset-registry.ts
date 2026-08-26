/**
 * Creative asset registry (CR.1 / M.2).
 *
 * Identity is sha256(bytes) + byte size per user. Channel ids record that
 * an asset has been uploaded to a Meta ad account or TikTok advertiser
 * at most once. Registration is additive — a missing 161 table must never
 * fail the existing Meta upload.
 */

import { createHash } from "node:crypto";

import {
  mergeAspectHints,
  parseAspectFromFilename,
  type DetectedAspect,
} from "../clients/asset-queue/aspect-detect.ts";
import { isRelationMissing } from "../plan/schema-probe.ts";

export const CREATIVE_ASSETS_TABLE = "creative_assets";
export const CREATIVE_ASSET_CHANNEL_IDS_TABLE = "creative_asset_channel_ids";

export const REGISTRY_CHANNELS = ["meta", "tiktok"] as const;
export type RegistryChannel = (typeof REGISTRY_CHANNELS)[number];

export const REGISTRY_MEDIA_KINDS = ["image", "video"] as const;
export type RegistryMediaKind = (typeof REGISTRY_MEDIA_KINDS)[number];

export const REGISTRY_ASPECTS = ["1:1", "4:5", "9:16", "other"] as const;
export type RegistryAspect = (typeof REGISTRY_ASPECTS)[number];

export interface ContentIdentity {
  contentHash: string;
  byteSize: number;
}

export interface CreativeAssetRow {
  id: string;
  userId: string;
  contentHash: string;
  byteSize: number;
  filename: string;
  mediaKind: RegistryMediaKind;
  aspectRatio: RegistryAspect;
  durationSeconds: number | null;
  storageBucket: string;
  storagePath: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface CreativeAssetChannelIdRow {
  assetId: string;
  userId: string;
  channel: RegistryChannel;
  scope: string;
  platformId: string;
}

export function fingerprintBytes(bytes: Uint8Array | Buffer): ContentIdentity {
  return {
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
  };
}

export function isRegistryAspect(value: string): value is RegistryAspect {
  return (REGISTRY_ASPECTS as readonly string[]).includes(value);
}

export function resolveRegistryAspect(input: {
  filename: string;
  probed?: DetectedAspect | null;
  slotHint?: string | null;
}): RegistryAspect {
  const fromFilename = parseAspectFromFilename(input.filename);
  const merged = mergeAspectHints(fromFilename, input.probed ?? "other");
  if (isRegistryAspect(merged) && merged !== "other") return merged;
  const hint = input.slotHint?.trim() ?? "";
  if (isRegistryAspect(hint)) return hint;
  return merged === "other" ? "other" : merged;
}

export function metaPlatformId(input: {
  mediaKind: RegistryMediaKind;
  hash?: string | null;
  videoId?: string | null;
}): string | null {
  if (input.mediaKind === "image") {
    const hash = input.hash?.trim() ?? "";
    return hash || null;
  }
  const videoId = input.videoId?.trim() ?? "";
  return videoId || null;
}

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
};

type FilterChain = {
  eq: (col: string, value: string | number) => FilterChain;
  maybeSingle: () => Promise<QueryResult>;
};

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => FilterChain;
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict?: string },
    ) => {
      select: (cols?: string) => {
        maybeSingle: () => Promise<QueryResult>;
      };
    };
  };
};

function asClient(supabase: unknown): LooseClient {
  return supabase as LooseClient;
}

export function rowToCreativeAsset(row: Record<string, unknown>): CreativeAssetRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    contentHash: String(row.content_hash),
    byteSize: Number(row.byte_size),
    filename: String(row.filename),
    mediaKind: row.media_kind === "image" ? "image" : "video",
    aspectRatio: isRegistryAspect(String(row.aspect_ratio))
      ? (row.aspect_ratio as RegistryAspect)
      : "other",
    durationSeconds:
      typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    storageBucket: String(row.storage_bucket ?? "campaign-assets"),
    storagePath: String(row.storage_path),
    thumbnailUrl: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function findAssetByFingerprint(
  supabase: unknown,
  userId: string,
  identity: ContentIdentity,
): Promise<
  | { ok: true; asset: CreativeAssetRow | null }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const { data, error } = await asClient(supabase)
    .from(CREATIVE_ASSETS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("content_hash", identity.contentHash)
    .eq("byte_size", identity.byteSize)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "creative_assets read failed",
    };
  }
  return { ok: true, asset: data ? rowToCreativeAsset(data) : null };
}

export async function findChannelId(
  supabase: unknown,
  input: {
    assetId: string;
    userId: string;
    channel: RegistryChannel;
    scope: string;
  },
): Promise<
  | { ok: true; platformId: string | null }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const { data, error } = await asClient(supabase)
    .from(CREATIVE_ASSET_CHANNEL_IDS_TABLE)
    .select("platform_id")
    .eq("asset_id", input.assetId)
    .eq("channel", input.channel)
    .eq("scope", input.scope)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "creative_asset_channel_ids read failed",
    };
  }
  const platformId =
    data && typeof data.platform_id === "string" ? data.platform_id : null;
  return { ok: true, platformId };
}

export async function findAssetByChannelId(
  supabase: unknown,
  input: {
    userId: string;
    channel: RegistryChannel;
    scope: string;
    platformId: string;
  },
): Promise<
  | { ok: true; assetId: string | null }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const { data, error } = await asClient(supabase)
    .from(CREATIVE_ASSET_CHANNEL_IDS_TABLE)
    .select("asset_id")
    .eq("user_id", input.userId)
    .eq("channel", input.channel)
    .eq("scope", input.scope)
    .eq("platform_id", input.platformId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "creative_asset_channel_ids lookup failed",
    };
  }
  return {
    ok: true,
    assetId: data && typeof data.asset_id === "string" ? data.asset_id : null,
  };
}

export async function upsertRegisteredAsset(
  supabase: unknown,
  input: {
    userId: string;
    identity: ContentIdentity;
    filename: string;
    mediaKind: RegistryMediaKind;
    aspectRatio: RegistryAspect;
    durationSeconds?: number | null;
    storageBucket: string;
    storagePath: string;
    thumbnailUrl?: string | null;
    existingId?: string;
  },
): Promise<
  | { ok: true; asset: CreativeAssetRow; created: boolean }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const existing = await findAssetByFingerprint(supabase, input.userId, input.identity);
  if (!existing.ok) return existing;
  if (existing.asset) {
    return { ok: true, asset: existing.asset, created: false };
  }

  const row = {
    id: input.existingId,
    user_id: input.userId,
    content_hash: input.identity.contentHash,
    byte_size: input.identity.byteSize,
    filename: input.filename,
    media_kind: input.mediaKind,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds ?? null,
    storage_bucket: input.storageBucket,
    storage_path: input.storagePath,
    thumbnail_url: input.thumbnailUrl ?? null,
  };
  const insert = asClient(supabase)
    .from(CREATIVE_ASSETS_TABLE)
    .upsert(row, { onConflict: "user_id,content_hash,byte_size" });
  const { data, error } = await insert.select("*").maybeSingle();
  if (error) {
    const raced = await findAssetByFingerprint(supabase, input.userId, input.identity);
    if (raced.ok && raced.asset) return { ok: true, asset: raced.asset, created: false };
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "creative_assets upsert failed",
    };
  }
  if (!data) {
    const raced = await findAssetByFingerprint(supabase, input.userId, input.identity);
    if (raced.ok && raced.asset) return { ok: true, asset: raced.asset, created: false };
    return { ok: false, tableMissing: false, error: "creative_assets upsert returned no row" };
  }
  return { ok: true, asset: rowToCreativeAsset(data), created: true };
}

/**
 * Record a platform id. A hit for the same asset+channel+scope is a no-op
 * and keeps the first platform_id — never a second upload.
 */
export async function recordChannelId(
  supabase: unknown,
  input: CreativeAssetChannelIdRow,
): Promise<
  | { ok: true; platformId: string; wrote: boolean }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const existing = await findChannelId(supabase, {
    assetId: input.assetId,
    userId: input.userId,
    channel: input.channel,
    scope: input.scope,
  });
  if (!existing.ok) return existing;
  if (existing.platformId) {
    return { ok: true, platformId: existing.platformId, wrote: false };
  }

  const insert = asClient(supabase).from(CREATIVE_ASSET_CHANNEL_IDS_TABLE).upsert(
    {
      asset_id: input.assetId,
      user_id: input.userId,
      channel: input.channel,
      scope: input.scope,
      platform_id: input.platformId,
    },
    { onConflict: "asset_id,channel,scope" },
  );
  const { error } = await insert.select("platform_id").maybeSingle();
  if (error) {
    const raced = await findChannelId(supabase, input);
    if (raced.ok && raced.platformId) {
      return { ok: true, platformId: raced.platformId, wrote: false };
    }
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "creative_asset_channel_ids upsert failed",
    };
  }
  return { ok: true, platformId: input.platformId, wrote: true };
}

export async function loadAssetsByIds(
  supabase: unknown,
  userId: string,
  ids: string[],
): Promise<
  | { ok: true; assets: CreativeAssetRow[] }
  | { ok: false; tableMissing: boolean; error: string }
> {
  if (ids.length === 0) return { ok: true, assets: [] };
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          in: (
            col: string,
            values: string[],
          ) => Promise<{
            data: Record<string, unknown>[] | null;
            error: { code?: string; message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await client
    .from(CREATIVE_ASSETS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "creative_assets list failed",
    };
  }
  return { ok: true, assets: (data ?? []).map(rowToCreativeAsset) };
}
