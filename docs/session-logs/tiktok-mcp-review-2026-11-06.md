# TikTok MCP review: use cases for the campaign creator and Creative Lab (6 Nov 2026)

Two new TikTok MCP servers are connected in Claude. Probed live today; results below are from real calls, no credentials in this file.

Verified by a live call: `auth_advertiser_get`, `account_user_get` (basic fields), `discovery_search`, `discovery_search_recommend_get`, `discovery_cml_list_get`. Not called yet, so their field names below come from the tool descriptions or the API docs and need checking before a build prompt: `report_integrated_get` metric names, `account_user_get` demographic/activity fields, `identity_video_get` on a real Spark identity, publish and comment tools.

## Reconciled with Matas's handover (same day)

The handover's guardrails win where this file differs:
- F (organic publishing) and G (comment replies/hide) are **not** done from chat. When a client account authorises the Social connector, untick Post, Upload draft and comment create/delete/hide. Comment *reading* (triage) stays in.
- No MCP writes at all on the ads server (`smart_plus_*`, `bc_create`, anything via `tool_execute`). A, B and H below are app code on the app's own token (`lib/tiktok/`), with the MCP used only as the spec.
- Adds from the handover not in this file: preflight id checks (pixel, event, identity, audience) before `preflight.ts`; the CIRQLIN "posted about you" mention signal; ad-hoc reporting in chat.
- Adds from this file not in the handover: TikTok rounds in the Lab judge (A), Spark auth as the Lab's clip rights record with expiry (B), CML music licence is TikTok-only so a CML render must never reach Meta (C).

### Handover next steps run on 6 Nov
- **Business token vs `tiktok_accounts`:** `auth_advertiser_get` returns exactly the 8 advertiser ids stored in `tiktok_accounts` (Louder and Amaad rows have no advertiser id). Match.
- **`report_integrated_get` vs the app's rollup:** 30 Oct–5 Nov, advertiser level, 5 advertisers. Electric Group £219.27, 128,041 impressions, 422 clicks, 45 results; Ironworks and Black Butter £0. `event_daily_rollups` for the same window: Electric Brixton £219.27, 128,041, 422. Exact match. Ironworks' 18 campaigns all £0 that week.
- **`discovery_search_recommend_get` for briefing:** generic `discovery_search` trends ("Girls Movember", "Wax Cracking trend") are not briefable. Seeded queries are: "techno london" → "techno london december", "drumsheds london techno", "fabric london techno", "techno london student", "techno london tomorrow". "Electric Brixton" → "id check", "security", "inside", "tickets", "review". Those are fan questions people search before going; they suit `pov` / venue captions ("POV: you're inside Electric Brixton") and landing-page FAQ lines (ID policy). Thin for small cities ("club night newcastle" returned 2).
- Venue Social authorisation, the mention list and the Spark sourcing pass are still waiting on a client TikTok login.

## What is connected

**1. Marketing API server** (`advertiser_info_get`, `identity_video_get`, `file_music_get`, `creative_portfolio_list_get`, `report_integrated_get`, `smart_plus_*`, `catalog_*`, plus a `tool_list` / `tool_get` / `tool_execute` dispatcher that exposes the whole v1.3 surface: ad/adgroup/campaign CRUD, review info, appeals, audience size estimate, quotas, and more).

`auth_advertiser_get` returns eight advertisers, including the ones the app already manages: Junction 2 / The Bridge (7629749960501886977), Black Butter Records (7525753407332696065), Crowd Sauce x Louder (7086756716284526594), Latenight (7681317718284304385), Ironworks (7639802149165301776), Back of House, Immersive Sports, Bits and Pieces. Same token scope as the app's `tiktok_accounts`.

**2. Accounts / Business API server** (`account_user_get` with daily metrics and audience demographics, comment list/reply/like/visibility, mention + hashtag tools, `account_user_post_publish` / `photo_publish` / `publish_status_get`, post authorisation (Spark) status/update/delete, `discovery_search`, `discovery_search_recommend_get`, `discovery_cml_list_get` / `discovery_cml_post_list_get`).

`account_user_get` resolved to **Matas's personal account** (`ma_t_as`, 28 followers, `is_business_account: false`, `has_advanced_access: false`). So today this server reads and writes one account, and it is not a client's. Every Accounts-API use case below needs the client's TikTok account (NX, Puzzle, Ironworks, Junction 2) authorised through the Business Account flow first; demographics and some discovery personalisation also need a Business account and, from 20 Mar 2026, an approved Accounts API access application.

## Use cases, mapped to the roadmap

### A. Creative Lab judging on TikTok (fills a known gap)
`ad_daily_insights` is Meta-only; TikTok rounds were deferred for that reason. `report_integrated_get` (AUCTION_AD, ad level, `time_increment=1`, spend/impressions/clicks/conversions/`video_play_actions`, `video_watched_2s/6s`, `average_video_play`) gives the same per-ad per-day grain. The existing `tiktok-active-creatives` cron already reads this family. A `tiktok_ad_daily_insights` table (or a `channel` column on `ad_daily_insights`) would let the M1 judge run unchanged on TikTok rounds with the ad group's optimisation event as the result column. This is the single highest-value item: the Lab becomes cross-channel without new logic.

### B. Artist clip sourcing (M4) via Spark
`identity_video_get` (`identity_type: AUTH_CODE`, `keyword` search, `exclude_adsonly`) lists the posts an artist has Spark-authorised to an advertiser, and `account_user_post_authorize_status_get` / `_update` manages the authorisation on the account side. This is exactly rule (b) of the rights rule ("clips come from a TikTok Spark authorisation"): a Spark auth code is both the clip source and the written-permission reference. Proposed: `creative_lab_clips.source = 'spark'` with `rights_ref = <auth code / item_id>`, pulled from this endpoint rather than Drive. The 3-day/7-day/30-day/365-day Spark durations become `rights_expires_at` on the clip, and the round builder refuses a clip whose auth lapses before the round window ends.

Limit: there is still no endpoint that reads another creator's public TikToks. Discovery of candidate artist posts stays manual (or via the artist's team sending the Spark code), same as today.

### C. Pre-cleared audio (M6 `artist_card_audio` / replaced-audio path)
`discovery_cml_list_get` (GB, 30DAY) returned the Commercial Music Library with artist, duration and trend window; `file_music_get` (`music_scene: CREATIVE_ASSET`, `sources: SYSTEM`) returns the same library scoped to an advertiser for ad creation. Use: when a clip's audio is `replaced` (rights or copyright), pick a CML track by tempo/duration from this list instead of silence. `discovery_cml_post_list_get` shows the top posts on a track, useful to judge whether a track is already associated with club content. Copyright note from the tool: CML music may only be used in creatives served on TikTok, so a CML-backed render must be TikTok-only (Lab `channel = 'tiktok'`), never cross-posted to Meta. That needs a `audio_license: 'tiktok_cml'` flag on `creative_lab_renders` so the Meta attach path refuses it.

### D. Hooks and search terms (M3 caption writer, Google Search plans)
`discovery_search` returns trending search keywords; `discovery_search_recommend_get` turns a seed into related queries (`"club night newcastle"` → `"club night newcastle halloween"`; thin for niche seeds, broad ones work better). `account_user_hashtag_suggestion_get` and `mention_top_hashtag/word_list` give hashtag and phrase frequency once a client account is connected. Use: a "trending phrases" panel feeding the caption writer's `pov` / `question` styles with real search language, and a source of candidate keywords for Google Search plan import. Low effort: one cron per client per week, counts only.

### E. Account analytics for the client dashboard
`account_user_get` fields include daily `followers_count`, `profile_views`, `video_views`, `likes`, `comments`, `shares`, plus `audience_countries`, `audience_genders`, `audience_ages`, `audience_activity` (hour-of-day). With a client account connected this fills the "TikTok organic" gap on `/admin/[clientSlug]/insights` the same way Mailchimp tag growth does, and `audience_activity` gives a data-backed posting/launch hour per client. Counts only, no PII.

### F. Organic posting of Lab winners
`account_user_post_publish` (video by URL or file, caption, privacy, disable comments/duet/stitch, auto-add music) and `publish_status_get`. Use: a winning Lab render is posted organically to the client's account, then Spark-authorised back to the advertiser so the paid ad carries the organic post's social proof. This is the Instagram-style "boost the post" loop TikTok has lacked in the app. Gate it like everything else: operator approval, never automatic.

### G. Comment operations
Comment list/reply/like/hide and mention tools. Use: a per-event comments view with "hide" and canned replies ("tickets at the link in bio"), and, more usefully for the Lab, comment volume and sentiment per ad as a secondary judge signal. Replies must be operator-written or operator-approved; no auto-reply.

### H. Creative review and appeals (ops)
Via the dispatcher: `ad_review_info_get`, `adgroup_review_info_get`, `adgroup_appeal`, `adgroup_quota_get`. Use: a cron that posts to `ads_ops` when a TikTok ad is rejected with the reason, and a one-click appeal from the Published library. Cheap, reuses the Slack service.

### I. What the MCP does not change
- `smart_plus_*` is exposed. The launcher's rule stays: Smart+ is a hard preflight blocker; nothing here should call it.
- `catalog_*` and VSA carousels are irrelevant to events.
- `ad_audience_size_estimate` is a nice-to-have for the TikTok drawer's refine tab (reach estimate before launch), on the same read-only footing as Meta's.

## Suggested order
1. A (TikTok ad-day insights → Lab judge cross-channel). Needs a migration and one cron; the read is already written in `lib/tiktok/`.
2. B (Spark as clip source with `rights_ref` and expiry). Small, and it is the rights rule made concrete.
3. H (rejection alerts). One cron, Slack service exists.
4. E + D (client account connect, analytics, trending phrases). Needs the Business Account OAuth per client and the Accounts API access application.
5. C (CML audio with the TikTok-only licence flag). After M6 audio work.
6. F + G (publish, comments). After 4, operator-gated.

## Open points for Matas
- Which client accounts to connect first (NX and Puzzle are the Lab pilots).
- Whether to apply for Accounts API advanced access now (demographics, personalised discovery) so it is in place by M5.
- Confirm the CML tracks are acceptable as replaced audio given the TikTok-only licence, or whether replaced audio stays silent/licensed-elsewhere so one render can serve both channels.
