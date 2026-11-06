# Cursor prompt: Creative Lab M4a BUILD, find Instagram clips (2026-11-06)

Rulings on Cursor's M4 review (6 Nov):
1. Read the artist's own Instagram edge first (instagram_actor_id via the Page Matas's token reaches). Business Discovery is the fallback and only ever lists: no file, so its candidates go to "request from team".
2. Rights: one tick. Matas: "I would know if the permissions are sorted… a simple tick box would suffice." Cleared = approved_at set by the tick (who/when automatic). The tick covers the artist's feed; there is no separate permission_covers_feed tick. rights_doc_ref becomes an optional note. §2 wording: "No round is built for an artist until Matas has ticked them as cleared. Instagram Graph reads (the artist's own media or Business Discovery) find and fetch clips only for a cleared artist; they are never the permission."
3. Ranking: score = (likes + 3 × comments) ÷ followers × 0.5^(age_days / 90), window 365 days, so Enzo's 14 Apr reel (0.12) still ranks. Carousel video slides count.
4. Frames: Remotion Lambda still sheet (FrameSheet), 8 frames, not 5. Text found only on the cover/thumbnail → "check by eye", not a rejection. Prompt as proposed, claude-sonnet-4-6, forced tool.
5. Licensed music: `copyright_check_information` per candidate on the own edge → new column audio_match (boolean null; null = unknown, as through Business Discovery).
6. Use the existing ig_username; fill it from GET /{instagram_actor_id}?fields=username. Add clients.instagram_business_id (Claude sets Puzzle's after the migration). External id: the IG media id goes in both external_id and source_file_id.
7. Correction: migrations 201, 202 and 203 ARE applied in production (6 Nov). 204 is next.
8. Split agreed: M4a (find + list), then M4b (check + import), with TikTok (M4c) later. Keep card changes minimal: the redesign comes as its own build from the design thread's mockups.
9. Example post De91R-0tEmw: not Enzo's own post. Matas to say whose; a collab/other-account post isn't fetchable as a file → "request from team".

```
[Use Opus] BUILD Creative Lab M4a: find an artist's best Instagram clips and list them. No downloads, no imports, no Lambda yet. Branch cursor/creative-lab-m4a off fresh main. One PR. Follow the rulings in docs/session-logs/cursor-prompt-creative-lab-m4a-build-2026-11-06.md (read it first) and your own M4 review.

Production database rule: Vercel previews use the production Supabase. No DDL or writes from the branch; migration 204 is written, not applied (201–203 are already applied).

=== Migration 204 ===
- clients.instagram_business_id text, with a comment.
- creative_lab_artists:
  - ig_synced_at timestamptz
  - ig_last_error text
  - Comment rights_doc_ref as an optional note, now that the tick is the record.
- creative_lab_clips:
  - overlay_check jsonb
  - audio_match boolean (null = unknown)
- creative_lab_ig_candidates:
  - columns: artist_id, ig_media_id, permalink, media_type, media_product_type, posted_at, likes, comments, followers_at_fetch, score, has_file boolean, file_source ('own_edge' | 'none'), audio_match, status ('candidate' | 'requested' | 'imported' | 'skipped'), reason, fetched_at;
  - unique (artist_id, ig_media_id);
  - owner RLS like 197.
  - This is where candidates are listed between runs. Never store media_url (it expires and is a file address).

=== Rights tick ===
- Card: replace "Approve rights" + the rights ref field with one "Cleared" tick. Ticking sets approved_by = the session user and approved_at = now; unticking clears them, and propose refuses until it's ticked again.
- The note field is optional, behind Edit.
- Update the roadmap §2 text to the wording in the rulings file.

=== Discovery (lib/creative-lab/ig-discovery.ts) ===
findArtistClips({ artistId }):
- The artist must be cleared.
- Own edge first: GET /{instagram_actor_id}/media (paged up to 150 posts) with media_type, media_product_type, permalink, timestamp, like_count, comments_count, children{media_type,id}, and followers from GET /{instagram_actor_id}?fields=followers_count,username. Fill ig_username.
- Fallback when the own edge can't be read: Business Discovery through clients.instagram_business_id. Rows have has_file false and file_source 'none'.
- VIDEO, REELS and carousel video slides, within 365 days. Score as in the rulings. Top 8 not already imported, rejected or requested.
- audio_match: copyright_check_information, one call per top-8 candidate on the own edge only.
- Upsert creative_lab_ig_candidates. Write ig_synced_at, or ig_last_error in plain words.
- Never log tokens or media_url.

=== Route + card (minimal) ===
- POST /api/creative-lab/artists/[id]/find-clips (session + ownership).
- On the artist row:
  - a "Find clips on Instagram" button;
  - a compact list (permalink, posted date, likes, comments, score, "file available" / "request from team", music match).
  - "Request from team" marks the row requested. No import button yet; that's M4b.

=== DON'T ===
No downloads, no Lambda, no vision, no clip rows, no TikTok, no layout redesign.

=== TESTS ===
Own edge vs fallback selection, carousel slides, score + decay + window, already-imported exclusion, copyright flag per post, uncleared artist refused, unticking blocks propose.

=== VERIFY ===
npm test, tsc + ESLint on touched files, npm run build. Read-only against prod for Enzo Siragusa: paste the top 8 rows findArtistClips would write (not written). Push once. Report SHA, PR. Stop.
```
