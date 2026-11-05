# Creative Lab: review and build roadmap (2026-11-05)

Matas's goal: ad creative that learns from its own results. First use: artist clips with overlay captions for Puzzle 4th Birthday (P26-BDAY, Luke Dean). Inputs so far: Matas's brief, the fal.ai competitor review, and the creative tooling thread's hand-back.

## 1. What is true in the repo today (checked 5 Nov)

| Claimed | Reality | Consequence |
|---|---|---|
| "Remotion pipeline proven at scale" | `lib/creatives/remotion/provider.ts` renders **stills** in-process behind `FEATURE_REMOTION` (composition `4tfCityStatic`). `app/api/admin/remotion/render-reel` renders a **photo reel** video. No composition takes a source video and burns a caption. | Caption-on-clip rendering is new work (M2), not a wrapper. |
| Per-ad daily results | `ad_daily_insights` has spend, registrations, purchases, link clicks, video plays per ad per day. | Judging a round is a query, no new data needed. |
| Learning with low-spend discounting | `lib/learning/shrink.ts`: funded ad = ≥ £5; a row is thin under 3 ads / £? spend / 10 results; shrinks toward client → vertical → all with k = 10. `phase_at_launch` is read first when staging. | Caption tags need their own dimension and a stricter bar so one event's rows don't shrink the client pool. |
| AI tagger | `creative_tags` has `dimension` / `value_key` / `value_label`; assignments carry `source` and `confidence`. Dimensions today: Format, Asset type, Visual format, Hook, Messaging angle. | Add `caption_style` as a dimension with `source = 'creative_lab'` (known at creation, confidence 1). |
| Attach into an existing ad set | Meta: standalone wizard "Add to existing campaign / ad set" (`lib/meta/attach-*`). TikTok: `attach_adgroup`. Both record `launched_ads` with `ad_name`, `creative_name`, `asset_content_hashes`. | A round launches through existing code; the Lab only builds drafts. |
| Spark post picker | `lib/tiktok/spark-posts.ts` lists an authorised identity's posts with `poster_url`. | TikTok sourcing = Spark auth from the artist. Already supported. |
| Business Discovery | Not in the repo. App is on Standard access; `instagram_manage_insights` not requested. | Needs a probe before it's planned on. |
| TikTok Sans | On Google Fonts (open licence). | No font purchase. Ship it with the Remotion bundle. |

## 2. Design rules

1. **Facts from the event record only.** Captions are generated from `events` (name, date, venue, lineup, sale state). A caption that contains a date or price not in the record fails validation. The 15.11 mistake in the hand-back is the failure this prevents.
2. **One locked caption style, versioned.** One Remotion component, values measured from a canonical reference clip, a reference-frame check in CI. The caption writer never sets styling.
3. **One ad per clip × caption.** No dynamic creative (decided Oct 2026, #1050). Ad name encodes both in ASCII only, so later parsing by regex works: `LUKEDEAN-clip01_cap-lineup1`.
4. **Judge weekly, on the ad's `phase_at_launch`** (Matas, 5 Nov): result = registrations before on-sale, purchases after. The window is 7 days of data, not a spend threshold. Two signals, both from `ad_daily_insights`: Meta's own spend share within the ad set (Meta moves budget to the assets that perform, so winners show even at £5/day) and cost per result. A winner is one Meta funded **and** that converted cheaply; an ad Meta starved is a loser; an ad Meta funded but that converted dearly is flagged, not promoted. Champions are re-tested once before they're treated as settled.
5. **Matas approves every round.** Drafts are built paused; launch goes through the existing attach flow and its gates. No auto-launch, no auto-pause in v1.
6. **Rights first.** The rule, verbatim: *"No Creative Lab round is built for an artist until (a) written permission for paid use of their content is stored against the artist record, and (b) the clips come from a TikTok Spark authorisation, files supplied by the artist's team, or an Instagram post the permission names. Business Discovery is for finding clips, never for using them."*
7. **Learnings flow across every client, weighted by evidence.** Matas's rule: what works for Ironworks should power tests for Puzzle, tailored per event, exactly as he does by hand. The data stays inside the platform. So `caption_style` is an ordinary tag dimension in `tag_performance` and uses the existing client → vertical → all shrinkage (`lib/learning/shrink.ts`, k = 10, thin under 10 results). That shrinkage already stops six Puzzle ads from outweighing the pool; no separate quarantine bar. The round proposer reads the `all` scope for caption styles with at least `ok` confidence and offers them for any event.
8. **Scarcity facts come from ticket outlets.** Once on sale, scarcity captions ("Final release", "Under 100 left") are generated from `event_ticket_tiers` (tier_name, price, quantity_sold, quantity_available), the same source as the ticket warnings on the Music Venue Group landing pages. No connection exists for Skiddle, so Puzzle's tiers are entered by hand before a scarcity caption can run.
9. **Who the loop tests for.** Primary use: a promoter testing artist content (Puzzle with Luke Dean or Enzo Siragusa). Matas records the artist's approval and the starting caption; when an artist's team shares a presskit, its raw clips and images join the clip pool.

## 3. Roadmap

Sizes: S = 1–3 files (Claude Code), M = one Cursor PR, L = two or more Cursor PRs. Each milestone has a gate that must be true before the next starts.

### M0: Prove the loop by hand (this week, no code)
- Source clips: the uncaptioned originals of UGC 1–4 are in Drive folder `1uf2yj9K_AT8dZuGe4vLiF1Ni-odFHOth` (four SnapInsta mp4s, 5–13 MB, publicly readable). The captioned UGC 1–4 in `1icTEvZt7bkTD3yXN1q3XoSoTTQOm2MMa` are references, not sources. Raw→UGC mapping by frame match, recorded in the M2 session log.
- Pick the canonical Luke Dean reference clip; measure the caption style (font size, stroke, line height, position at 1080×1920) → `style_profile.json` v1.
- Get written paid-use permission from Luke Dean's team; ask for Spark auth.
- Write 3 captions from the event record (lineup reveal, question, scarcity once the next release is confirmed). Render them on UGC 1 with ffmpeg/Pillow in the creative tooling thread, using TikTok Sans.
- Launch via "Add to existing ad set", paused; Matas approves. Pause UGC 3 and 4.
- The M0 renders are Pillow/ffmpeg approximations. They are good enough to launch and learn from. They are **not** the style reference; the artist's native clip is.
- Gate: 6 ads live, ad names carry clip × caption, `ad_daily_insights` rows arriving.

**Event record check (5 Nov):** `P26-BDAY-DAY` has `event_date` 27 Dec, `presale_at` 29 Oct, `general_sale_at` 30 Oct, venue Circuit; lineup is free text in `notes`. `ticket_price` is NULL on all three P26 rows, and there is no release/tier field. So M0 captions can carry lineup, date and venue only. A scarcity caption needs a stored release name, price and on-sale time, which M1 adds (`creative_lab_facts` or a `ticket_releases` table). Nobody types a date into a prompt.

### M1: Data model + judging (S–M, Claude Code then Cursor)
- Migration: `creative_lab_rounds` (event_id, artist, round_no, built_at, approved_at, launched_at, status) and `creative_lab_ads` (round_id, clip_id, caption_id, caption_style, caption_text, meta_ad_id, verdict). `creative_lab_clips` (artist, source = spark|file|discovery, external_id, storage_path, rights_ref). `creative_lab_captions` (style, text, facts_hash).
- `caption_style` dimension in `creative_tags`; assignments written at round build with `source = 'creative_lab'`.
- Judging query: per round, 7-day window, two signals (Meta spend share within the ad set, cost per result for `phase_at_launch`); mark winner / loser / flagged. Pure function + test.
- `caption_style` joins `tag_performance` as a normal dimension; nothing special in the learning refresh.
- Scarcity facts: the caption validator reads `event_ticket_tiers`; a scarcity caption is rejected when the event has no tier rows.
- Artist record: `creative_lab_artists` (name, ig_username, tiktok_identity_id, rights_doc_ref, approved_by, approved_at, starting_caption). A round is blocked without `rights_doc_ref`.
- Gate: M0's round judged by the function and the verdicts match what Matas would call by hand.

### M2: Caption render (M–L, Cursor)
- Remotion composition `CaptionOnClip`: source video + caption JSON + style version → one 9:16 mp4. The caption stays inside the 4:5 safe rectangle. TikTok Sans bundled. Audio passthrough with an option to replace from a cleared track. Sizes: M6 "Output sizes".
- Placements: one 9:16 file per caption. Feed, Stories and Reels crop that file. See M6 "Output sizes".
- Render location: `render-reel` already runs on Vercel with `maxDuration = 600` and 3008 MB, so the "60 s timeout" objection is out of date for this repo. M2 renders a 30 s clip through that route and records the time. Remotion Lambda only if that measurement fails; it is not pre-decided.
- Reference-frame check: render the v1 caption over the **designated reference clip** and SSIM the text region against the artist's original frame; fail under threshold. Style file hashed and versioned.
- Gate: the M2 render of the reference caption matches the reference clip frame within the SSIM threshold. M0's manual renders are not the standard.

### M3: Caption writer + round builder (M, Cursor)
- `generateCaptions(eventId, style, n)`: Claude call with the event record; output `{style, text, chars, lines}`; validator rejects any date/price/venue not in the record and any text over 4 lines at the fixed size.
- `proposeRound(eventId)`: reads the last round's verdicts, applies "winning clip + new captions, winning caption + new clips", builds drafts (paused) into the event's current ad set via the attach path, writes `creative_lab_*` rows.
- UI: a "Creative Lab" card on the event page: artist, clips, rounds, each round's ads with verdicts, Approve → launch.
- Gate: round 2 for Luke Dean built by the tool, approved by Matas, launched through attach.

### M4: Clip sourcing (M, Cursor; one probe first by Claude Code)
- Probe: Business Discovery on Luke Dean's account with Matas's token (`/{ig-user-id}?fields=business_discovery.username(...)`). Record what comes back (likes, comments, media_url; whether video views do). If the app's Standard access blocks it, stop here and rely on Spark/files.
- TikTok: reuse the Spark post picker. **Limit, stated now:** TikTok exposes stats only for posts the artist has already authorised. There is no way to rank an artist's other TikToks by virality. Ranking on TikTok is "among authorised posts"; the ask to the artist's team is therefore "authorise your best recent posts", not "authorise one".
- Instagram: ranking by likes and comments relative to follower count and post age is possible only if the probe clears; Reels view counts are not expected.
- M1's tables model this: `creative_lab_clips.source` is `spark | file | instagram`; engagement columns are nullable and only filled where the platform supplies them.
- Top 3–5 not yet used per round.
- Clips land in `campaign-assets` with `rights_ref` required.
- Gate: a fortnightly dry-run lists candidate clips for Luke Dean without any manual search.

### M5: Cadence + alerts (S, Claude Code)
- Cron proposes a round when due: every 14 days until 30 days before `general_sale_at`/`event_date`, then 7, then 3 in the last fortnight. Proposal only; Slack `ads_ops` message "Round N ready for approval".
- Fatigue flag: frequency > 3 over 7 days on a Lab ad → Slack, no pause.
- Gate: one full cycle (propose → approve → launch → judge → propose) with no manual steps except approval.

### M6: The full asset bank and the payday cadence (Matas, 5 Nov; Broadwick Live review)

Matas's standing creative system, which the Lab must reproduce rather than replace. Example banks: Puzzle Open Air `1TQGF9g6uHBWZI402cxOGy8OLlXpFtGu4`, Puzzle October `1Iid8hF8HoyiZE-QOoHJgNiRbBuZL0FBK`, Junction 2 `1UF2WCeYi0dO_WQYPG5F3QwNf2LMB_JVJ`, NX venue UGC `1IvC1aqp3yWwhCCmd2bCJHxudUdvD-bvy`. Their folder names are the taxonomy: Static / Static Audio / Video / Motion / Lineup / Early Bird / Combo Tickets / PRICE MOVE / GEN SALE / FINAL TICKETS / Payday Push / Student push / Debranded / monthly Refresh.

**Asset types** (`creative_lab_asset_type`, a new tag dimension alongside `caption_style`):

| Type | Source | Lab can generate? | Compositions needed |
|---|---|---|---|
| `lineup_artwork` | client / designer | no; the editables feed everything below | — |
| `ugc_caption_promoter` | artist raw clip + native caption, 3rd person ("Luke Dean joins…") | yes (M2) | `CaptionOnClip` |
| `ugc_caption_artist` | same clip, 1st person ("Can't wait to play…") | yes (M2, new caption voice) | `CaptionOnClip` |
| `clip_overlay` | artist/venue clip + lineup-artwork overlay template (Broadwick style: presents / date+venue / artist / on-sale state) | yes | `PromoterOverlay` (new) |
| `artist_card` | press shot + key-info overlay, optionally A–Z of the rest of the lineup | yes, from the same template | `PromoterOverlay` still variant |
| `artist_card_audio` | artist card + 15–20 s snippet of the artist's best-known track | yes, audio track supplied and cleared | `PromoterOverlay` + audio |
| `ticket_warning` | standalone update: presale live / presale sold out / gen sale live / final 100 / price rise on DATE / 80% sold / final 200 | yes, facts from `event_ticket_tiers` + sale dates | `TicketWarning` (new, artwork-derived) |
| `promo_edit` | client-supplied | no; registered and tested as-is | — |
| `experience` | "Southampton's biggest house party", "biggest student party", "house and disco all night long" | yes, copy from an approved angle list per client | `PromoterOverlay` with angle copy |

Every generated type takes its words from the event record and tiers, through the M1 validator. Audio snippets need a cleared-track reference on the clip (`audio_status = cleared`).

**Ticket warnings are promo, not literal facts** (Matas, 5 Nov). They are an aggressive reading of tier data, as on the Music Venue Group cirqlin pages' tier-% warnings. So the validator's job for warnings is grounding, not literalism: a warning may only be generated when the tier data supports its direction (a "final X" needs that tier to be the last with stock; "80% sold" needs ≥ 80% sold on the relevant tiers; "price rises on DATE" needs a dated tier change). The wording itself is marketing. **Every warning is confirmed by Matas before it runs**: warnings never auto-launch, even once rounds do.

**Brand templates from PSD** (Matas wants overlays to work from the designers' open PSD files + fonts). Remotion can't read PSDs, so this is a one-time *template ingest* per brand, not a render-time step:
1. Parse the PSD with `ag-psd` (pure JS): export each non-text layer as a PNG at full resolution, read each text layer's font, size, colour, tracking, position and box.
2. Rebuild the text layers in a Remotion composition using the actual font files, bound to event facts (artist, date, venue, on-sale state).
3. Side-by-side check against a Photoshop export of the same PSD with the same copy; Matas approves the template once; it's versioned like the caption style.
Needs from the designer per brand: the PSD with layers named, and the font files (OTF/TTF). Fonts licensed through Adobe Fonts can't be copied out for server rendering; those need a desktop/server licence or a substitute the designer approves. Adding `ag-psd` is a new dependency (approval needed). This is M6a, before `PromoterOverlay`.

**Output sizes** (Matas, 5 Nov; supersedes M2's "9:16 and 4:5 per render"):
- **Video: 9:16 only.** Every caption, overlay and warning keeps its key information inside the centred 4:5 safe rectangle (1080×1350 inside 1080×1920, i.e. the middle 70% of the height), so the one file crops to Feed, Stories and Reels and ships as a single multi-placement asset. No separate 4:5 video render; M2's `aspect` becomes a safe-zone check on the 9:16, and `crop_focus_y` becomes the vertical position of that rectangle. Meta is sent the 9:16 only; the `ENABLE_MULTI_PLACEMENT_ASSETS` pairing isn't used for Lab videos.
- **Statics: 1:1, 4:5 and 9:16**, because WhatsApp previews crop to 1:1 and email looks best at 4:5. The 9:16 static's key info also sits inside the 4:5 rectangle, so an audio-overlay version (M6 `artist_card_audio`) can be made from it and used across placements.
- The style profile and the overlay templates therefore carry one safe rectangle per aspect family, and the reference-frame check runs on the 9:16.

**Cadence** (`creative_lab_cadence`, replaces the flat 14-day rule in M5):
- The bank runs with no CTA by default (content-led: UGC captions, clip overlays, artist cards, experience assets) to drive cheap site traffic that the retargeting ad set catches.
- Around **payday** (last Friday of the month): a price-rise warning in the days before, then a follow-up warning after (final X group / early entry / X release), then the next warning about two weeks on, in step with real tier movement from `event_ticket_tiers`.
- On campaigns of 3+ months: warnings and harder pushes only in the payday window; content-led assets from mid-month / weeks 3–4.
- Near the event (M5's tightening) the warning cadence takes over entirely.
- The proposer therefore has two calendars: the round calendar (which assets to test) and the push calendar (when ticket warnings run). Both are visible on the event page before approval.

**What Broadwick Live does that confirms this** (Ad Library, 5 Nov; ~22 active ads across three shows): UGC + native caption + urgency copy on the nearest show; clip overlays and artist cards from one fixed template on shows months out; the artist's own poster as a control; one creative per ~3 ad sets; copy that only states facts (artist, venue, date, on-sale state). No impression data is visible for UK ads, so this is a mix observation, not a performance one.

### M7: Reuse beyond captions (later)
- Animate the winning static (Remotion keyframes) as a Lab ad type.
- One asset → all placements as a single entry point.
- A `creative-lab` MCP exposing generate / render / propose / attach for Claude, read-only first.
- Second artist, second client.

## 4. Decisions (settled 5 Nov)

1. Rights rule: approved as quoted in §2 rule 6, with rule 9's additions.
2. Budget: no fixed ceiling per round. Rounds are judged on a week of data; budget is whatever the event's ad set carries, even £5/day.
3. Cross-client learning: on, through the existing shrinkage; no quarantine (§2 rule 7).
4. Scarcity captions: from `event_ticket_tiers` once on sale (§2 rule 8). Puzzle's tiers must be entered by hand first.

(Render location is not a decision: M2 measures on the existing 600 s / 3 GB route and escalates to Lambda only on a failed measurement.)

## 4a. Business Discovery probe (do before writing the M1 prompt)

Run in Graph API Explorer with app **Off/Pixel Ad Tool** and a user token carrying `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` (Standard access works for an app admin). Puzzle's Instagram business id is `17841456620568454` (@puzzleofficialuk).

```
GET /v21.0/17841456620568454?fields=business_discovery.username(<luke_dean_ig_username>){followers_count,media_count,media.limit(25){id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url}}
```

Record: does it return at all; are `like_count`/`comments_count` present; is `media_url` present for Reels; any `view`/`play` field. Outcome decides whether `creative_lab_clips` gets Instagram engagement columns.

**Probe result (5 Nov, run by Matas in Graph Explorer, app 2068209467369792, Standard access):** works.
- @lukedeandj: 152,918 followers, 178 posts. 25 returned per page with cursor paging.
- Per post: `like_count`, `comments_count`, `timestamp`, `permalink`, `media_type`, `media_product_type`. No view or play count.
- Reels return a direct `media_url` mp4 (signed, expiring `oe=`), plus `thumbnail_url`. Download at fetch time and store in `campaign-assets`; never store the URL.
- Mix: 2 Reels in the last 25 posts (8 Jul, 48 s, 31.4k likes / 317 comments, his top post of the year; 6 Jan, 140 s, 10.5k / 205). The other 23 are carousels. Carousel children may hold video; the M4 fetch must request `children{media_type,media_url}` to find them.
- Consequence for M1: `creative_lab_clips` gets nullable `ig_like_count`, `ig_comments_count`, `ig_followers_at_fetch`, `ig_posted_at`; no views column. Ranking = (likes + 5 × comments) / followers, decayed by post age.
- Consequence for sourcing: Instagram gives roughly 1–2 usable videos a month from this artist. TikTok (Spark auth) remains the main clip supply; Instagram supplements it.

## 5. Risks

- Meta mutes or rejects clips with released music (~30% per the hand-back, unverified). Spark path avoids it; file path needs cleared audio.
- Business Discovery may not work on Standard access; the roadmap doesn't depend on it.
- Small samples: £50/ad gives a ±40% read. Re-test champions before treating them as settled.
- Style drift between TikTok's and Instagram's text tools; the reference clip decides which we match.

## 6. What happens first

M0 this week, in parallel: measure the style, get the rights, run round 1 by hand. M1's migration and judging function can start now because they only depend on `ad_daily_insights`.
