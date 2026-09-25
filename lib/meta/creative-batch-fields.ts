/**
 * Field list pulled per creative in the batched Graph read.
 *
 * Lives here so the Meta importer can reuse the same list without
 * importing `lib/reporting/active-creatives-fetch.ts` (`server-only`,
 * and the reporting fetcher pulls `client.ts`). One list — do not
 * write a second one.
 *
 * Mirrors the bulky subtree the old single-phase /ads call requested
 * inline — same fields, just reachable through the batched endpoint.
 * `object_story_spec` and `asset_feed_spec` are requested as flat
 * field names; Meta returns the full sub-tree for each.
 *
 * Transport is Meta's Batch API (`POST /` with a `batch` array), not
 * `GET /?ids=` — Graph API v26.0 removed the `ids` query parameter.
 */

export const CREATIVE_BATCH_FIELD_LIST = [
  "id",
  "name",
  "title",
  "body",
  "thumbnail_url",
  "image_url",
  "video_id",
  "object_story_id",
  "effective_object_story_id",
  "instagram_permalink_url",
  "call_to_action_type",
  "link_url",
  // Flat sibling of call_to_action_type. A batch that asks for both
  // returns the nested { type, value.link } object; Meta does not
  // treat the two names as a duplicate field (unlike the nested
  // expansions PR #74 had to drop).
  "call_to_action",
  "object_story_spec",
  "asset_feed_spec",
  // PR-snapshot-cache — needed alongside the existing OSS / AFS
  // fields so `extractPageIdsFromCreative` can resolve the FB
  // Page that owns each video for Advantage+ creatives that
  // surface the page id in the per-platform block rather than on
  // top-level OSS. One extra Graph field on an already-paid
  // batched call — does NOT add per-ad fan-out and stays
  // comfortably under `CREATIVE_BATCH_SIZE=25`'s response budget.
  "platform_customizations",
  // PR #74 — earlier PR #71 also requested nested-expansion
  // forms for the two parents above (asset_feed_spec.videos /
  // .images and object_story_spec.link_data.child_attachments)
  // on the assumption Meta would union them with the flat
  // parent. It does not: Meta's field parser rejects duplicate
  // top-level field names with "Syntax error" and fails the
  // whole batch, so PR #73's diagnostic logs caught
  // creative_batch_done hydrated=0 on every share render. The
  // flat form already returns the full sub-tree (see comment
  // block above), which is what extractPreview's waterfall
  // reads, so the nested forms were redundant from the start.
] as const;

export const CREATIVE_BATCH_FIELDS = CREATIVE_BATCH_FIELD_LIST.join(",");

/**
 * Meta's documented cap is 50, but on heavy events (e.g. 372 distinct
 * creatives with Advantage+ asset_feed_spec trees) the 50-id payload
 * trips Meta's "reduce the amount of data you're asking for"
 * (meta_code=1) cap on ~60% of batches. Halving to 25 keeps each
 * batch under the cap on observed worst-case events.
 */
export const CREATIVE_BATCH_SIZE = 25;
