# Cursor prompt: Creative Lab M5 R2 BUILD (2026-11-06)

R1 merged (#1090, 273923c). Migration 205 applied; Puzzle 4th Birthday lineup backfilled (5 library artists, 5 event_artists rows, Enzo + Luke Lab rows linked).

```
[Use Opus] BUILD Creative Lab M5 R2: clip grid, captions as feed ads, round matrix, insights from stored verdicts. Branch cursor/creative-lab-m5-r2 off fresh main (after #1090). Check `gh pr list --search "creative lab"` first. One PR. Follow your M5 review (sections 3, 4 F3–F5, 6) and docs/creative-lab/creative-lab-redesign-2026-11-06.html F1 (what's working), F3, F4, F5. App tokens only.

Production database rule: previews use the production Supabase. No DDL or writes from the branch. No migration expected; if one is truly needed, write 206 and don't apply it.

Build, in components/dashboard/events/creative-lab/:
- F3 clips:
  - Keeping / New / Can't run grid of 9:16 first-frame tiles (thumbnail from the render or the clip's creative_assets; initials when there is none), with source badge, duration, artist + number and one status. Rights text only on hover.
  - Can't run = an uncleared artist's clip, or one the render refused (the reason in words). Luke Dean's render-test clip lands here.
  - Keeping only once a verdict exists.
  - Drop zone + the folder import + "Find clips on Instagram" tiles from creative_lab_ig_candidates (permalink, ♥, 💬, aspect, posted date, "Request from team"). "Add" and "Skipped — text overlay" are present but disabled with "coming in M4b".
- F4 captions:
  - The generator with labelled segmented controls (Angle, Stage defaulting from the event, How many 1/3/5, Pair with).
  - Each caption as a feed post: page avatar + name + Sponsored, overlay lines with real line breaks (never "/"), the paired clip frame, and a CTA bar by stage (on sale → Get tickets).
  - ✎ ✕ ✓ under it. Edit lets Matas change the overlay and primary text and re-runs the validator.
  - A failed check is one plain sentence; a passed check draws nothing.
  - Ran captions under "Ran in round n" with cost per result and verdict.
- F5 round: captions across, usable clips down, one cell per ad, all on by default, tap to exclude (local until Propose). The total line reads "{n} ads · {clips} × {captions}, {off} left out". The disabled reason sits beside the button. At 393, the first three pairings plus "+ n more".
- F1 "what's working": drawn only when a verdict exists; the angle line and the winning clip, per your review section 3. Verdict words as you mapped them (null = Holding, flagged = "cost 1.5× the usual", thin = Untested). Unit from result_metric. Em dash, never £0.00.
- Remove the old clips/captions/rounds form from creative-lab-card.tsx; nothing of the old form remains.

Tests:
- clip grouping, including Luke's clip in Can't run;
- caption render with line breaks and no "/";
- a failed-check sentence;
- round matrix counts with exclusions;
- the insight lines hidden with no verdicts, plus the angle maths on fixtures;
- verdict chip mapping.

VERIFY: npm test, tsc + ESLint on touched files, npm run build. Read-only against prod for Puzzle 4th Birthday: paste what each group would show (counts and statuses). Push once. Report SHA, PR. Stop.
```
