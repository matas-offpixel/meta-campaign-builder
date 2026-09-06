# Audit — Silent dual-asset placement drop (4:5 shown in 9:16 Reels)

- **Date:** 2026-06-05
- **Branch:** `cursor/dual-placement-asset-audit`
- **Stage:** A (audit only — no code changes)
- **Author:** Cursor (Opus)

## TL;DR

The bug is **real and confirmed**, but the originally-suspected root cause
(strict-mode sanitizer stripping `asset_feed_spec`) is a **red herring**.

The actual root cause: **no code path in the app ever builds a multi-asset,
per-placement creative.** Both launch paths collapse a multi-aspect-ratio
creative down to a **single asset** chosen by a hard-coded priority order, then
send that one asset to Meta with no `asset_feed_spec` / `asset_customization_rules`.
Meta therefore renders the single chosen asset across **all** placements and
crops it to fit — exactly the reported "4:5 Feed image stretched into 9:16 Reels".

`asset_customization_rules` and `customization_spec` appear **nowhere** in the
codebase. The feature to map different assets to different placements has never
been implemented; the dual/full asset-mode wizard uploads the extra ratios but
the launch builders discard everything except the priority winner.

## Build paths in scope

| Launch path | Entry point | Creative builder | Sanitizer run? |
|---|---|---|---|
| **Bulk-attach** (Innervisions "add to existing ad sets") | `app/api/meta/bulk-attach-ads/route.ts:258` | `buildCreativePayload` | **No** — never calls `sanitizeCreativeForStrictMode` |
| **Standalone wizard launch** | `app/api/meta/launch-campaign/route.ts:2267` | `buildCreativePayload` | Yes (`strictMode` default ON), `route.ts:2276` |

Both paths call the **same** `buildCreativePayload` in `lib/meta/creative.ts`.
The bug is therefore in the shared builder, not in either route. Bulk-attach
doesn't even run the sanitizer, yet still exhibits the bug — which by itself
rules the sanitizer out.

## How the single asset is chosen (the actual mechanism)

`lib/meta/creative.ts`:

- `buildCreativePayload` (`:444`) decides video vs image by scanning **all**
  variations for any `videoId` (`hasVideoId`, `:450`). If any video exists →
  `buildVideoCreative`, else → `buildLinkCreative`.
- `buildVideoCreative` (`:288`) → `pickPrimaryVideoAsset` (`:207`) →
  `VIDEO_PRIORITY = ["9:16", "4:5", "1:1"]` (`:177`). Picks the **first** matching
  asset and emits a single `video_data.video_id`.
- `buildLinkCreative` (`:242`) → `pickPrimaryImageHash` (`:183`) →
  `HASH_PRIORITY = ["4:5", "9:16", "1:1"]` (`:176`). Picks the **first** matching
  hash and emits a single `link_data.image_hash`.
- All `pickPrimary*` helpers only read `assetVariations[0].assets` — even the
  first variation's non-winning ratios are dropped.

**Image creatives → `HASH_PRIORITY` puts `4:5` first.** So a dual `4:5 + 9:16`
image creative always sends the **4:5** hash for every placement, including
9:16 Reels/Stories. That is the precise reported symptom (`Plans_Feed.png`
cropped into Reels).

### Note on the exact reported combo (4:5 image + 9:16 video)

If a *single* creative genuinely held a 4:5 image **and** a 9:16 video in the
same variation, `hasVideoId` would be true and `buildVideoCreative` would emit
the **9:16 video** everywhere (video priority lists 9:16 first) — i.e. the video
would win, not the image. Since the user observed the **image** winning, the
failing ad was one of:

1. An **image-mode** creative with `4:5 + 9:16` images (most likely — matches
   `Plans_Feed.png`). 4:5 wins via `HASH_PRIORITY`; the 9:16 was discarded. **OR**
2. The 4:5 image and 9:16 video were **separate single-asset creatives**, and the
   image creative rendered its 4:5 across all placements.

Either way the root cause is identical: the builder emits one asset and no
`asset_feed_spec`, so Meta cross-publishes + crops it. There is no code path
that would have routed the 9:16 asset to the Reels placement.

## Does either path emit `asset_feed_spec` / `asset_customization_rules`?

**No.** Neither builder constructs `asset_feed_spec`. Repo-wide search:

- `asset_customization_rules` — **0 matches**
- `customization_spec` — **0 matches**
- `asset_feed_spec` — only appears as:
  - a key in `STRICT_MODE_TOP_LEVEL_STRIPS` (`creative.ts:598`) that the
    sanitizer *removes* (but it's never present to remove), and
  - **read-side** parsing in `lib/reporting/*` and `lib/audiences/*` (extracting
    IDs from already-live Meta creatives — outbound-irrelevant).

So the sanitizer's `asset_feed_spec` strip is dead code for our outbound
creatives: the builders never produce one. Removing the strip would change
nothing about this bug.

## DB confirmation — the extra ratios WERE uploaded with valid IDs

Supabase project `zbtldbfjbhfvpksmdvnt`.

Dual-asset creatives exist with **both** ratios populated and valid Meta IDs,
confirming the upload step works and the loss happens at build time:

Wizard draft `eb8e6a17-9f7a-4f2d-bd18-a31a31c0c397` (updated 2026-06-04):

| Creative | mediaType | ratios present (kind) |
|---|---|---|
| `Lineup Video` | video | `4:5(vid), 9:16(vid)` |
| `No Lineup Video` | video | `4:5(vid), 9:16(vid)` |
| `Static Lineup` | image | `4:5(img), 9:16(img)` |
| `Static No Lineup` | image | `4:5(img), 9:16(img)` |

Recent bulk-attach drafts (2026-06-05) carried single 9:16 video assets, each
with `has_video_id = true` — uploads succeed and IDs are captured. (`uploaded`
status, `videoId` non-null.)

**Conclusion:** assets upload fine and both ratios persist in the draft JSON with
valid `videoId` / `assetHash`. The data needed for per-placement rendering is
present; only the **build step** throws it away.

> Caveat: the specific `Plans_Feed.png` / Innervisions ad was already launched and
> its source draft is no longer among the current `bulk_attach_drafts` rows
> (drafts get overwritten/cleared). The dual-asset drafts above are
> representative of the identical code path and prove both ratios persist with
> valid IDs.

## Why the strict-mode suspicion was wrong

1. Bulk-attach (a confirmed-failing path) never calls the sanitizer at all.
2. The builders never emit `asset_feed_spec`, so the strip is a no-op for it.
3. The single-asset collapse happens in `pickPrimary*` **before** any sanitizer
   runs, and fully explains the symptom on its own.

## Recommendation for Stage B (fix)

Implement genuine per-placement creatives. Shape:

1. **New builder branch** in `lib/meta/creative.ts` (e.g. `buildAssetFeedCreative`)
   that fires when a creative's variation has **more than one aspect ratio**.
   Emit `asset_feed_spec` with:
   - `images[]` / `videos[]` carrying each ratio's `image_hash` / `video_id`
     plus a stable `adlabel` per asset.
   - `asset_customization_rules[]` mapping each asset label to a
     `customization_spec` placement group, e.g.
     - `4:5` → Feed group (`facebook_positions: [feed]`,
       `instagram_positions: [stream]`)
     - `9:16` → Stories/Reels group (`instagram_positions: [story, reels]`,
       `facebook_positions: [facebook_reels, story]`).
   - bodies/titles/link/CTA mirrored into `asset_feed_spec` as required by Meta.
   - Keep single-asset `object_story_spec` path unchanged for `single` mode.
2. **Sanitizer change:** stop stripping a *user-configured* `asset_feed_spec`.
   Distinguish "ours" (has `asset_customization_rules` we built) from Advantage+
   auto-generated specs. Simplest: only build `asset_feed_spec` in the new
   branch, and **remove `asset_feed_spec` from `STRICT_MODE_TOP_LEVEL_STRIPS`**
   (or guard the strip so it only fires when there are no
   `asset_customization_rules`). Keep stripping the other Advantage+ fields.
3. **Both routes get it for free** since they share `buildCreativePayload` —
   add the multi-ratio branch there.
4. **Mixed media within one placement set** (4:5 image + 9:16 video) is allowed
   by Meta's `asset_feed_spec` (`images[]` + `videos[]` + rules referencing
   either). Decide whether the wizard should support mixed-media dual mode, or
   keep dual mode same-media and treat mixed as separate creatives.
5. **Validation:** require every active placement group to have a matching asset,
   or fall back gracefully (Meta rejects rules pointing at missing labels).
6. **Tests:** unit-test the new builder emits correct `asset_customization_rules`
   for `dual` and `full` modes; assert single mode is byte-unchanged; assert the
   sanitizer preserves our `asset_feed_spec` but still strips Advantage+ fields.
7. **Manual verify:** relaunch a `dual` creative and confirm Ads Manager preview
   shows distinct assets per placement (4:5 in Feed, 9:16 in Reels), not one
   cropped asset across all.

### Key references

- `lib/meta/creative.ts:176-231` — priority arrays + `pickPrimary*` collapse
- `lib/meta/creative.ts:288-347` — `buildVideoCreative`
- `lib/meta/creative.ts:242-286` — `buildLinkCreative`
- `lib/meta/creative.ts:444-480` — `buildCreativePayload` video/image branch
- `lib/meta/creative.ts:597-606` — `STRICT_MODE_TOP_LEVEL_STRIPS` (red herring)
- `app/api/meta/bulk-attach-ads/route.ts:258` — bulk-attach build call (no sanitizer)
- `app/api/meta/launch-campaign/route.ts:2267-2288` — wizard build + sanitizer
- Meta docs: Marketing API → Placement Asset Customization (`asset_feed_spec`,
  `asset_customization_rules`).
