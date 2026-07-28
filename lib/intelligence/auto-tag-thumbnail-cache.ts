import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mediaTypeFromContentType,
  type AutoTagImage,
  type AutoTagThumbnailCache,
} from "./auto-tagger.ts";
import {
  CREATIVE_THUMBNAIL_BUCKET,
  extFromContentType,
} from "../meta/creative-thumbnail-pure.ts";

/**
 * lib/intelligence/auto-tag-thumbnail-cache.ts
 *
 * Supabase-backed implementation of `AutoTagThumbnailCache`. Image bytes are
 * content-addressed in the existing `creative-thumbnails` Storage bucket
 * (migration 068e — provisioned for the ad_id-keyed venue-report thumbnail
 * proxy) under a distinct `auto-tag/hash/` prefix: no new bucket needed, the
 * bucket's public-read policy is bucket-wide, and writes go through a
 * service-role client (RLS-exempt), matching `creative-thumbnail-cache.ts`'s
 * existing writes to this same bucket.
 *
 * The caller only has a URL up front and doesn't know the content hash
 * until bytes are downloaded, so a `get(url)` lookup needs a url -> hash
 * index. That index lives in the `auto_tag_thumbnail_url_index` Postgres
 * table (migration 149) rather than a second Storage object: this bucket's
 * `allowed_mime_types` is image-only, and a first attempt at a JSON-manifest
 * Storage object was silently rejected by that policy (Storage's `upload()`
 * returns `{ error }` rather than throwing) — caught by a live smoke test
 * against the real bucket, not by unit tests against a mock. See migration
 * 149 for the full story.
 *
 * `get` costs one DB read + one Storage read on a hit, one DB read on a
 * miss; `put` costs one Storage write + one DB upsert. Both are cheap
 * relative to a Meta CDN round trip and are best-effort — every error is
 * swallowed so an outage in either backing store degrades to "no caching",
 * never a tagging failure (see `resolveAutoTagImage` in `auto-tagger.ts`,
 * the only caller, which also wraps these calls defensively).
 */

const HASH_BLOB_PREFIX = "auto-tag/hash";
const URL_INDEX_TABLE = "auto_tag_thumbnail_url_index";

type SupabaseCacheClient = Pick<SupabaseClient, "storage" | "from">;

function urlHashFor(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function hashBlobPath(hash: string, contentType: string): string {
  return `${HASH_BLOB_PREFIX}/${hash}.${extFromContentType(contentType)}`;
}

export function createSupabaseAutoTagThumbnailCache(
  supabase: SupabaseCacheClient,
): AutoTagThumbnailCache {
  const bucket = supabase.storage.from(CREATIVE_THUMBNAIL_BUCKET);

  return {
    async get(url) {
      try {
        const { data: indexRow, error: indexErr } = await supabase
          .from(URL_INDEX_TABLE)
          .select("content_hash, content_type")
          .eq("url_hash", urlHashFor(url))
          .maybeSingle();
        if (indexErr || !indexRow) return null;

        const { content_hash: hash, content_type: contentType } =
          indexRow as { content_hash: string; content_type: string };
        const { data: imageBlob, error: imageErr } = await bucket.download(
          hashBlobPath(hash, contentType),
        );
        if (imageErr || !imageBlob) return null;

        const base64 = Buffer.from(await imageBlob.arrayBuffer()).toString(
          "base64",
        );
        return { base64, mediaType: mediaTypeFromContentType(contentType), hash };
      } catch (err) {
        console.warn(
          `[auto-tag-thumbnail-cache] get failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
    },

    async put(url, hash, image: AutoTagImage) {
      try {
        const { error: uploadErr } = await bucket.upload(
          hashBlobPath(hash, image.mediaType),
          Buffer.from(image.base64, "base64"),
          {
            contentType: image.mediaType,
            upsert: true,
            cacheControl: `${30 * 24 * 60 * 60}`,
          },
        );
        if (uploadErr) throw new Error(uploadErr.message);

        const { error: indexErr } = await supabase.from(URL_INDEX_TABLE).upsert(
          {
            url_hash: urlHashFor(url),
            content_hash: hash,
            content_type: image.mediaType,
          },
          { onConflict: "url_hash" },
        );
        if (indexErr) throw new Error(indexErr.message);
      } catch (err) {
        console.warn(
          `[auto-tag-thumbnail-cache] put failed for hash=${hash.slice(0, 12)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
  };
}
