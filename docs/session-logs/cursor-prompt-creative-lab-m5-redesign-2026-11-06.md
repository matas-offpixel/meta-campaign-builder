# Cursor prompt: Creative Lab M5, redesign from the design thread's frames (2026-11-06)

Design: docs/creative-lab/creative-lab-redesign-2026-11-06.html (F1–F5, hand-back table, data, acceptance; 1280 and 393). Matas's brief: too dry, too text-heavy, too many inputs; artists entered once and tagged (@); Spotify context; rights a single tick; visual previews; insights.

Rulings that adjust the design:
1. Use what exists. The Artists library is the existing `artists` table (spotify_id, instagram_handle, tiktok_handle, meta_page_id, profile_jsonb, enriched_at), and the lineup is the existing `event_artists` (is_headliner, billing_order). Both are empty today. No new artists table.
2. Clearance is per client artist (creative_lab_artists), not per event: an artist cleared for Puzzle stays cleared for Puzzle's next shows. creative_lab_artists gains artist_id → artists(id).
3. Instagram ranking is M4a's (own edge first, likes + 3 × comments over followers, 90-day half-life, 365-day window, top 8), not "last 30 by likes + comments".
4. Acceptance runs on Puzzle 4th Birthday (P26-BDAY, a092aca8-…), not Part 1. Part 1 and Part 2 are cancelled duplicates.
5. Colours: the app's existing tokens, not the frame's hex values. The frame's numbers and Spotify details are placeholders.

```
[Use Opus] REVIEW ONLY first. Do not create a branch or edit files.

Read docs/creative-lab/creative-lab-redesign-2026-11-06.html end to end (frames F1–F5, the Hand-back table, Data this needs, Acceptance) and the rulings at the top of docs/session-logs/cursor-prompt-creative-lab-m5-redesign-2026-11-06.md. Then read components/dashboard/events/creative-lab-card.tsx, lib/db/creative-lab.ts, lib/creative-lab/card-write.ts, the existing `artists` and `event_artists` tables and anything that reads them, lib/enrichment/spotify.ts + artist-pipeline.ts (Spotify search/enrich), the Artists library page (app/(dashboard)/artists), and where the event page renders Ticketing / Tickets sold.

This builds after M4a (cursor/creative-lab-m4a) merges. Assume M4a's candidates table, rights tick and minimal Find-clips list exist, and replace that minimal UI with F3's.

Report, in this order:
1. Data plan:
   - lineup as event_artists (is_headliner, billing_order) as the source of truth;
   - how creative_lab_event_facts.lineup/headliners stop being typed: derived on read, or written through from the lineup UI;
   - creative_lab_artists.artist_id → artists;
   - allowed_dates from the event date;
   - a one-off backfill (as a script Claude runs, not in the migration) creating library artists + event_artists for P26-BDAY's five names and linking Enzo Siragusa's and Luke Dean's Lab rows.
2. The @-tag: library search first, then Spotify search (findArtistCandidates). A Spotify-only pick creates the library artist. Is Spotify configured in prod (isSpotifyConfigured)? Is the top-tracks endpoint available to our app's credentials (Spotify restricted several endpoints for new apps in Nov 2024)? How long is the context cached, and where (artists.profile_jsonb + enriched_at)? "Played before" fills from the client's past event_artists.
3. Insights data:
   - per clip and per caption per round: cost per result, results and verdict, from creative_lab_round_ads + creative_lab_round_ad_launches + ad_daily_insights and the M1 judge;
   - the "what's working" line: the angle comparison and the current winning clip, client-scoped, drawn only when a verdict exists. Say which query feeds each.
4. Component plan for F1–F5 at 1280 and 393, with the app's tokens. List anything in the frames that has no data yet, and how it degrades (e.g. no Keeping group before any verdicts).
5. Moving Ticketing → the client's Ticketing tab link, and Tickets sold → Reporting, without breaking the event report.
6. Size and split. Probably R1 data + lineup/@-tag/rights rows + strip, then R2 clips grid + captions as ads + round matrix + insights.
Then stop.
```

Build prompt after the review: rulings above + Cursor's report, branch cursor/creative-lab-m5-r1 (then -r2), migration written not applied, VERIFY against the Acceptance section on Puzzle 4th Birthday with screenshots at 1280 and 393.
