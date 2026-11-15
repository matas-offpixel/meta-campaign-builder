# Cursor prompt: Creative Lab R3, rights by voice + live gaps from design pass 3 (2026-11-06)

This combines the rights change (docs/session-logs/cursor-prompt-creative-lab-rights-voice-2026-11-06.md, which was never sent separately) with the gaps the design thread found on the live Puzzle 4th Birthday page (pass 3). One PR, to avoid two branches editing the same card.

```
[Use Opus] BUILD Creative Lab R3: rights by voice + the live gaps from design pass 3. Branch cursor/creative-lab-r3 off fresh main (after #1091). Check `gh pr list --search "creative lab"` first. One PR.

Design rules apply: docs/creative-lab/design-rules.md (rules 1–14 and the named components). Frames: docs/creative-lab/creative-lab-pass-3-2026-11-06.html (A, caption overlay), creative-lab-pass-2-2026-11-06.html (B1 rights). Commit design-rules.md and the pass-2 / pass-3 html files (already in the working tree) in this PR.

Production database rule: previews use the production Supabase. No DDL or writes from the branch. If a migration is needed, write 206 and don't apply it.

=== 1. Rights by voice ===
Build everything in docs/session-logs/cursor-prompt-creative-lab-rights-voice-2026-11-06.md: clearance gates artist_first_person only; uncleared artists run promoter-voice; import and discovery need no clearance; Can't run only for render-refused or over-limit clips; tests as listed there. Chips per the rights chip component: "Promoter page only" / "✓ Cleared — artist channels too" plus who and when. The note text goes on hover only.

=== 2. Live gaps (pass 3, section A) ===
- Artist row:
  - the primary action follows the component: Find clips / Add Instagram / Clear for artist channels;
  - a support act with no clips gets no Mark cleared button;
  - remove the stray ▶ ⓘ pair under each row (ⓘ opens the artist card on the name).
- Artist photos fill in by themselves:
  - on lineup add, and once for library artists with no spotify_id, run the existing Spotify search by name;
  - one exact-name match → enrich (photo, genres, spotify_id);
  - several matches → the row shows "Pick the right {name}", opening the matches in a sheet;
  - also run it now for Puzzle 4th Birthday's five artists, as a dry-run-by-default script Claude applies.
- Clip tile first frames:
  - every tile shows the clip's real frame;
  - simplest: a muted, playsinline <video preload="metadata"> on a short-lived signed URL at ~0.5 s, tap = play;
  - generate a stored poster JPG later if this is slow.
  - No initials boxes when a file exists.
- Caption overlay component (rule 13):
  - TikTok Sans with wdth 120 and weight 400, the same font files Remotion uses, white fill, black stroke outside the letters (paint-order stroke fill, or the approach that matches the render), no shadow;
  - block centre ~36% down the 9:16 frame;
  - play bottom-left, scrubber along the bottom.
  - Use it in the feed-post caption, render rows, round cells and the timeline.
  - Check it against docs/creative-lab/ugc1-side-by-side.png and attach a side-by-side screenshot.
- Feed-post caption:
  - the media area shows the paired clip with the overlay;
  - primary text under it as body copy;
  - "Get tickets" as a real CTA bar;
  - ✓ as the primary button, ✎ ✕ as secondary buttons.
  - Pair with a clip that can run (the best New clip of a headliner), never a refused clip.
- Strip:
  - 4 cells, each with a kicker, a big count and a state line;
  - the step needing you highlighted;
  - "Next: …" plus one verb button (not "Go");
  - at 393, one row with full words (no "Line"/"Caps" abbreviations), shorter state lines instead.
- Caption generator: the selected option shows as selected (segmented control state).
- The event's presale and general sale dates show as "Not set" on an on-sale event. Leave the data alone; the strip shows "Add sale dates for the payday calendar" as a ⋯ link to the event edit.

=== DON'T ===
No layout changes beyond these. No Meta writes.

=== TESTS ===
The rights-voice tests, plus:
- primary action per artist state;
- the enrich flow (single match / several / none);
- the feed post never pairs a refused clip;
- the strip's highlighted step.

=== VERIFY ===
npm test, tsc + ESLint on touched files, npm run build.
- Paste the enrich dry-run for the five Puzzle artists (matches found).
- Screenshots of the caption overlay next to ugc1-side-by-side.png, and of the strip, lineup and a clip tile at 1280 and 393 if a session is available.

Push once. Report SHA, PR. Stop.
```
