# Launch url_tags

## PR

- **Number:** 1027
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1027
- **Branch:** `cursor/launch-url-tags`

## Summary

Every creative the app builds now carries Meta `url_tags`, so the landing URL identifies the campaign, ad set and ad by id:

`utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{adset.id}}&utm_term={{ad.id}}`

`buildCreativePayload` adds it once, after the per-shape builder returns, so every shape gets it: link_data image, video_data, asset_feed_spec rotation, asset_feed_spec multi-placement, the single-asset vertical fallback, and existing posts (Facebook and Instagram). When the operator's destination URL already has any `utm_` parameter (any case) or a `{{` macro, `url_tags` is left off and the operator's tags stand. Each creative logs `[url_tags] applied` or `[url_tags] operator_utm_kept` with its name.

## Scope / files

- `lib/meta/url-tags.ts` (new): `URL_TAGS`, `urlTagsFor(destinationUrl)`, `urlTagsReviewLine(...)`.
- `lib/meta/creative.ts`: `MetaCreativePayload.url_tags?: string`; `buildCreativePayload` wraps the former body (`buildCreativePayloadShape`) and applies the tags in one place.
- Callers checked, unchanged: `launch-campaign/route.ts`, `bulk-attach-ads/route.ts`, `create-creatives-and-ads/route.ts` (both builds) all pass the built object straight to `createMetaCreative`. `sanitizeCreativeForStrictMode` strips only `STRICT_MODE_TOP_LEVEL_STRIPS` (no `url_tags`) and link_data fields. `validateCreativePayload` reads the draft, not the payload. `graphPostWithToken` sends `JSON.stringify(body)` with `Content-Type: application/json`, so the macros are never URL-encoded.
- `components/steps/review-launch.tsx`: one line under Creative Integrity Mode — "Tracking: utm tags added to N ads." plus "M keep their own utm tags." when any are skipped. Counts ads on the ad sets that will launch (enabled, audience not removed; or the attached ad sets). No toggle.
- `lib/analysis/interest-performance.ts` + `scripts/interest-performance.mts`: `UtmRow.utm_term`; `joinFirstParty` resolves `utm_term` to a Meta ad id inside an ad set that `utm_content` already resolved, emits `perAd` (ad id → ad set, campaign, signups) behind the same `FIRST_PARTY_RATIO_RANGE` gate, and `adMatchedSignups` per campaign. The report JSON gains optional `firstParty.perAd`. No report regenerated. The analyser reads ad sets, not ads, so an ad id is not checked against Meta — it is trusted only under a resolved ad set. The Cirqlin CSV export has no `utm_term` column today; `parseUtmCsv` reads it when present (Cirqlin change out of scope).
- `lib/meta/import/map.ts`: comment — imported creatives get our tags at launch; the source creative's `url_tags` are not copied.
- Tests:
  - `lib/meta/__tests__/url-tags.test.ts` (new)
  - `lib/meta/__tests__/creative-url-tags.test.ts` (new)
  - `lib/landing-pages/__tests__/signup-schema.test.ts` (+1)
  - `lib/analysis/__tests__/interest-performance.test.ts` (+1)
  - `lib/meta/__tests__/existing-post-destination.test.ts`: "leaves a boost with no URL bare" expected keys gain `url_tags` — the only change to an existing expected payload.

## Probe — 2026-10-07

Off/Pixel ad account `act_932846012721428`, page `835830913221115`, operator token (Matas). Everything created PAUSED. Payloads were built with the real `buildCreativePayload` (`ENABLE_MULTI_PLACEMENT_ASSETS=1`) and `sanitizeCreativeForStrictMode`, then `url_tags` was added. Script: `scripts/out/probe-url-tags*.mts` (gitignored, not committed — it writes to Meta).

### Verified

- `POST /act_…/adcreatives` with `url_tags` is accepted on both link_data (a) and multi-placement asset_feed_spec (b, b2).
- `GET /{creative_id}?fields=url_tags,object_story_spec,asset_feed_spec` returns `url_tags` byte-identical to what was sent, macros literal, on both shapes. `link_data.link` / `asset_feed_spec.link_urls[].website_url` stay the bare destination — Meta keeps the tags separately.
- Ads on both shapes were created (paused).

### Not verified

- Click-time macro expansion on a delivering ad — any shape. All ads are paused; no click was made.
- The asset_feed_spec **rotation** shape (needs its own `is_dynamic_creative` ad set) and video_data / existing-post shapes were not posted. They get the same top-level key.

### Preview (recorded, not used as evidence)

The ad preview is not treated as an oracle for click-time behaviour. What it showed, for the record: `GET /{ad_id}/previews?ad_format=MOBILE_FEED_STANDARD`, iframe HTML fetched (HTTP 200, ~714 KB). The CTA `link_url` is an `l.facebook.com/l.php?u=…` redirect.

- (a) `u` = `https://offpixel.co.uk/?utm_source=meta&utm_medium=paid&utm_campaign=%7B%7Bcampaign.id%7D%7D&utm_content=%7B%7Badset.id%7D%7D&utm_term=%7B%7Bad.id%7D%7D` — macros not expanded.
- (b2) `u` = `https://offpixel.co.uk/`.
- `DESKTOP_FEED_STANDARD`, `INSTAGRAM_STANDARD`, `INSTAGRAM_STORY`, `FACEBOOK_STORY_MOBILE` carry no destination query string for either ad.

### Responses

| Step | Response |
|---|---|
| Campaign | `{"id":"120246955060140582"}` |
| Ad set | `{"id":"120246955060530582"}` |
| (a) creative | `{"id":"1371161968432558"}` |
| (a) ad | `{"id":"120246955061460582"}` |
| (b) creative, no IG identity | `{"id":"2327620081396075"}` |
| (b) ad | rejected: code 100, subcode 1772103, "Instagram account is missing — Select an Instagram account or Facebook Page to represent your business on Instagram." The multi-placement rule targets Instagram positions; a real launch passes the validated IG id. Not a `url_tags` rejection. |
| (b2) creative, `instagram_user_id` 17841403774937858 | `{"id":"1091193073780306"}` |
| (b2) ad | `{"id":"120246955069350582"}` |

No rejection mentioned `url_tags`.

### Ids to delete

- Campaign `120246955060140582` (`zz-url-tags-probe 2026-10-07 (PAUSED, delete)`) — removes ad set `120246955060530582` and ads `120246955061460582`, `120246955069350582`.
- Creatives `1371161968432558`, `2327620081396075` (orphan), `1091193073780306` stay in the creative library until deleted separately.

## Click-time check after the first live launch

Before this PR (2026-10-07) both counts are 0. After the first tagged launch delivers, numeric `utm_campaign` with a `utm_term` means real tags are arriving (counts only):

```sql
select 'event_signups' as source, created_at::date as day, count(*) as rows from event_signups where utm->>'utm_campaign' ~ '^[0-9]+$' and coalesce(utm->>'utm_term', '') <> '' group by 1, 2 union all select 'lp_page_views', occurred_at::date, count(*) from lp_page_views where utm->>'utm_campaign' ~ '^[0-9]+$' and coalesce(utm->>'utm_term', '') <> '' group by 1, 2 order by 2 desc, 1;
```

## Validation

- [x] `npm test` — node 6726 pass / 0 fail, vitest 6 pass
- [x] `npm run build`

## Notes

- Ledger: `meta_write_idempotency` keys a creative write on `hashMetaWritePayload(payload)`, so adding `url_tags` changes the hash. A retry of a launch that started before this PR mints a new creative instead of reusing the old one. Accepted; the hash is not special-cased.
- Existing live ads are not touched — no writes to existing creatives. Only creatives built after merge carry the tags.
- An existing-post boost with no destination URL also gets `url_tags` (every shape is tagged). Meta acceptance of `url_tags` on `source_instagram_media_id` / `object_story_id` creatives was not probed.
