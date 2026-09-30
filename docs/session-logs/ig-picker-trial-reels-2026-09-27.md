[Use Opus]

# PR C — Collapse trial-reel clusters in the Instagram post picker. One PR, `cursor/ig-picker-trial-reels`, off fresh `main`. Open, don't merge.

Matas, picking a Seth Troxler feed post: *"many of the reels are uploaded multiple times."* Instagram **Trial Reels** (Dec 2024) publish one video as several media objects, each shown to non-followers with a different hook/caption for ~72h, then the winner is shared to everyone. The account's `/media` edge returns every variant as its own item, so the picker at `components/steps/creatives.tsx` (the list `app/api/meta/instagram-posts/route.ts` feeds, fields `id,caption,media_type,media_url,thumbnail_url,permalink,timestamp`) shows 4–5 near-identical reels with different first lines. The operator has to guess which one is "the" post.

## 1 — Capture before clustering

Do not design the cluster key from this paragraph. Pull the `/media` list for an account that has trial reels (SCHAK `17841401050136820` or Seth Troxler — Matas can say which) with the current fields **plus** `media_product_type`, `is_shared_to_feed`, `children{id,media_type}`, `like_count`, `comments_count`. Put 3–5 rows of one cluster in the PR body (ids and timestamps; captions truncated). Then answer from the data, not from guesswork:

- Do variants share `media_url` or `thumbnail_url`? Identical → that is the key.
- Are they published within seconds of each other (`timestamp` delta)? Same `media_product_type: "REELS"`?
- Does any field mark the trial vs. the winner (`is_shared_to_feed`, or the winner has a later timestamp and non-zero `like_count` while trials sit at 0)?

If nothing in the capture distinguishes them reliably, say so and stop at §2 with the weakest safe grouping; do not ship a heuristic the capture does not support.

## 2 — One row per cluster

Group in the route (`lib/`-level pure function, tested) on the key §1 finds. The picker shows one row per cluster: the winner's caption if identifiable, otherwise the earliest; a badge `4 variants`; expanding the row lists every variant with its own caption and id so the operator can pick a specific one. Selecting the collapsed row selects the winner (or earliest). The `postId` stored on `existingPost` is always a single real media id — nothing about the cluster is stored.

## Guards

No migration. No change to what is launched — `buildExistingPostCreative` gets the same `source_instagram_media_id` shape. Do not touch `lib/tiktok/**`, `lib/optimisation/**`, `lib/google-ads/**`, `lib/google-search/**`. The Facebook tab of the picker is unchanged.

## Test plan

The captured cluster collapses to one row with the right variant count and the right default; expanding lists all; a non-clustered post is one row with no badge; two posts with the same caption but different media do **not** cluster (whatever the key is, caption alone must not be it). Selecting a collapsed row stores exactly one media id.

Full `npm test`, `npm run build`, check-run conclusions in the thread — not in a commit.
