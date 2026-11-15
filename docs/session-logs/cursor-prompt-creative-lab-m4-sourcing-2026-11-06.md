# Cursor prompt: Creative Lab M4, clip sourcing from artist Instagram / TikTok (2026-11-06)

Matas's rulings, 6 Nov:
- Rights rule amended: "Business Discovery may fetch a clip file only for an artist whose stored permission covers their feed. It is never the permission itself." (Supersedes "Business Discovery is for finding clips, never for using them.")
- Only pull clips with no other text overlays burned in.
- Clips come from the artist's own Instagram / TikTok. First test: Enzo Siragusa (permission covers feed footage), example post https://www.instagram.com/p/De91R-0tEmw/.

```
[Use Opus] REVIEW ONLY first. Do not create a branch or edit files.

Goal: the Lab finds an artist's best recent reels on Instagram, rejects any with burned-in text, and imports the rest as clips with no download/upload by Matas. TikTok is Spark codes for straight boosts.

Read: docs/session-logs/creative-lab-roadmap-2026-11-05.md (§2 rights rule, §4a Business Discovery probe, M4), lib/creative-lab/clip-intake.ts and clip-sync.ts (M3e folder import, reuse its registration/dedupe/trim path), creative_lab_clips columns (external_id, permalink, ig_like_count, ig_comments_count, ig_followers_at_fetch, ig_posted_at, fetched_at, audio_status), how the app calls Graph with Matas's token (user_facebook_tokens), lib/intelligence/auto-tagger.ts (Claude vision on creatives), and the TikTok Spark code paths (lib/tiktok/, identity/video info).

Proposed spec:

=== 1. Rights (amended rule) ===
- creative_lab_artists gains instagram_username and permission_covers_feed boolean default false (Matas ticks it when the written permission covers the artist's feed).
- Instagram import runs only when rights are approved AND permission_covers_feed is true. Business Discovery is never treated as permission.
- Update the roadmap §2 rule text to the amended wording.

=== 2. Discover (Instagram) ===
- GET /{puzzle-or-client IG business id}?fields=business_discovery.username(<artist>){followers_count,media.limit(50){id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count}}, using the client's connected IG business account and Matas's token, the same way the §4a probe did.
- VIDEO / REELS only, posted within the last 60 days.
- Rank by (likes + 3 × comments) / followers. Views aren't available through this API.
- Take the top 5 not already imported (external_id = IG media id).

=== 3. No burned-in text (Matas's rule) ===
- For each candidate, sample frames (0.5 s, 25 %, 50 %, 75 %, last second) plus the thumbnail, and ask Claude vision (the auto-tagger's client/model pattern) for a JSON verdict.
- Rejected:
  - added text overlays: captions, titles, "WATCH NOW…", subtitles, lyric text, promo text, date/venue graphics, watermarks with words.
- Not rejected:
  - text that is part of the scene: club signage, LED stage screens, DJ booth branding, T-shirt prints.
- Overlay found → skip, with reason "text overlay" and the frame times. Unsure → skip, with reason "check by eye".
- Store the verdict on the clip (new jsonb overlay_check) so it is auditable.
- Frame extraction: say how. Options: ffmpeg on Vercel (binary size?), a Remotion Lambda still/frames call (we already pay for Lambda), or parsing mp4 keyframes. Recommend one with cost per clip.

=== 4. Import ===
- media_url present: download, then the M3e path:
  - register in creative_assets;
  - clip row with source 'instagram', external_id, permalink, ig_* stats, fetched_at, rights_ref = the artist's rights_doc_ref;
  - trim to 30 s;
  - audio_status 'original', plus a flag when the reel uses licensed music (if the API exposes it) so Matas can mute or replace before launch.
- media_url absent (common on licensed-music reels): don't import. Add to a "request file from team" list on the card with the permalink.
- Automatic: the nightly clip-sync cron also runs Instagram discovery for eligible artists, max 3 new imports per artist per fortnight (Matas's fortnightly cadence). The card has "Find clips now".

=== 5. TikTok ===
- The artist row takes Spark auth codes. The card lists the authorised posts (identity video info) with views.
- These launch as straight Spark boosts with no overlay. Not a Lab caption test. State whether the existing TikTok attach launcher can take them as-is.
- No file download from TikTok.

=== 6. Card ===
- Instagram handle, "permission covers feed" tick, "Find clips now" button.
- Candidate list with thumbnail, likes, comments, posted date, verdict (imported / text overlay / no file / check by eye).
- "Request from team" list.

=== DON'T ===
No scraping, no third-party downloaders, no unofficial endpoints. No TikTok file downloads. No Meta writes.

Report, in this order:
1. A live READ-ONLY Business Discovery call for Enzo Siragusa (username from his IG account 17841401538493170) through the client's IG business account: list his last 10 VIDEO/REELS with media_product_type, whether media_url is present, likes, comments, date, permalink, and whether https://www.instagram.com/p/De91R-0tEmw/ is among them and has a media_url. No downloads, no DB writes.
2. Frame-extraction choice and cost; the vision prompt and cost per clip.
3. Whether the licensed-music flag is exposed anywhere.
4. Gaps or conflicts with M3e code.
5. Size; split into PRs if over ~1,500 lines.
Then stop.
```

## Added 6 Nov (Matas): every clip fitted to 9:16, native 9:16 first

- M4a ranking: aspect from the thumbnail header; multipliers 9:16 ×1.0, 4:5 ×0.7, 1:1 ×0.55, landscape ×0.3, unknown ×0.6 (sent as a #1089 push).
- M4b render fix (src/remotion/caption-style/profile.ts outputSize/cropWindow): today a portrait source that isn't 9:16 (4:5, 1:1) renders at its own aspect, and a landscape source gives a small centre plate (1920×1080 → 606×1080). Fix: every source is cropped to 9:16 (wider than 9:16 → crop width; taller → crop height), with a new creative_lab_clips.crop_focus_x (default 0.5) for the horizontal window, and the output is scaled to 1080×1920. Refuse with "too low quality after crop" when the cropped source is under 540 px wide. Tests per aspect. The drift guard stays on the 9:16 reference.
