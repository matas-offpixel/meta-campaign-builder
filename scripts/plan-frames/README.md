# plan-frames

Fixture-built frames rendered against `next start` with `ENABLE_PLAN_FRAMES=1`,
diffed against `docs/frames/<id>.png` at 0.2% pixel tolerance on Playwright
1.63.0 (Chromium r1243). No Supabase, no Meta / TikTok / Google calls, every
write killswitch unset. The loop that uses these renders is in
`docs/design-record/README.md`.

| Series | Surface | Widths | Fixtures |
|---|---|---|---|
| L, A, J, E | MML plan v2 | 1176 (L3, J2 also 768) | `fixtures.ts`, `builders.ts` |
| CL | Creative Lab card on the event page | 1280 and 393 | `lab-fixtures.ts` |

## Evidence pack

Every run writes `frames-evidence/`, uploaded by CI as the `plan-frames`
artifact:

- `index.md` / `index.json`: each file → frame id, width, check result.
- `shots/<id>.png`: every shot, as rendered on this run.
- `diff/<id>/expected.png`, `actual.png`, `diff.png`: for each shot over
  tolerance (no `diff.png` when the size changed).

A PR that changes `docs/frames/*.png` needs the `design-pass` label
(`.github/workflows/design-pass.yml`). Baselines come from
`frames-baselines.yml` (Ubuntu), never from a Mac.

## CL series

The real `CreativeLabCard` (`components/dashboard/events/creative-lab/`) on
one fixture each. Event: Fixture Night, 12 December 2026, Fixture Hall, client
Off Pixel Fixtures, status `on_sale` (CTA "Get tickets"). Launches are off
(`CREATIVE_LAB_LAUNCH_ENABLED` unset), so "Approve & launch" reads "Lab
launches are switched off".

Clips are two synthetic VP9 files in `public/frames/fixtures/` (Playwright's
Chromium has no H.264 decoder), made by `make-lab-clips.mjs`: stage lights
over a crowd, 2 s, first second still. The probe sizes in the fixtures are
1080×1920 and 1920×1080; the files are 360-px proxies. The caption overlay
uses the app's own TikTok Sans (`src/remotion/fonts/`, via `next/font/local`).
The runner fails a CL shot if any declared font face has not loaded.

| Id | State | What to check by hand |
|---|---|---|
| CL1 | Empty event, no facts, no ad set | Strip 0 empty · 0 none yet · 0 none yet · — not started (at 393: empty · none · none · none); "Next: Add the lineup."; "Star the headliners once the lineup is in."; "No lineup yet."; no Keeping / New / Can't run headings |
| CL2 | Lineup only | 5 artists, 3 starred (Ada North, Bea Lowe, Cal Reyes). Ada cleared ("Matas, 2 Nov"); the other four read "Promoter page only". Row action: Find clips for Ada, Bea, Cal and Eli (all have Instagram), Add Instagram for Dee. "Clear for artist channels" is the chip's link on Bea and Cal (starred, not cleared), not on Eli. Every row has an action beside its ⋯. Clip counts come from each fixture's own clips: CL2 has none, so every row reads "0 clips" (CL3: Ada 1, Bea 1; CL5 and CL6: Ada 2, Bea 1) |
| CL3 | 2 clips, 1 proposed Lineup caption | Clips: Ada North #1 IG 0:18 (native 9:16), Bea Lowe #1 file 0:24 (landscape, centre-cropped), both dashed Untested chips under "New · 2". Scrubbers span 0–18 s and 0–24 s, thumb at the 0.5 s poster. Feed post on Ada North #1: overlay "Ada North Bea Lowe / 12 December / Fixture Hall" on three lines; primary text "Ada North and Bea Lowe play Fixture Hall on 12 December."; headline "Fixture Night · 12 December · Fixture Hall" |
| CL4 | As CL3, primary text empty | The muted slot "No primary text yet — ✎ to add" in place of the primary text |
| CL5 | Round 1 proposed | 2 approved captions (Lineup, POV) × 3 clips = 6 pairings. The runner clicks Ada North #1 × POV off, so the line reads "5 ads · 3 × 2, 1 left out". "Round 1 · draft" lists those 5 pairings as "{artist} #{n} × {angle}", all Ready. Strip: Round 1 draft. No round has run, so there is no timeline |
| CL6 | Round 1 judged on signups | Ada North #1 × Lineup: Winner (olive), £0.50 / signup · 40 signups = £20.00. Bea Lowe #1 × POV: "cost 1.5× the usual" (brick), £0.75 / signup · 20 signups = £15.00 (0.75 ÷ 0.50 = 1.5). Ada North #2 × Lineup: Untested (dashed). Keeping 2, New 1. What's working: "Lineup captions beat POV by 33% on Off Pixel Fixtures" ((0.75 − 0.50) ÷ 0.75 = 33.3%) and "Ada North clip #1 is the current winner". Next: "Round 1 is judged. Propose round 2." Timeline: "Round 1 · judged · £0.58 / signup" (£35 ÷ 60 = £0.583) lists its ads with chip and cost: "Ada North #1 × Lineup" Winner £0.50 / signup · 40 signups; "Bea Lowe #1 × POV" struck through, "cost 1.5× the usual" £0.75 / signup · 20 signups; "Ada North #2 × Lineup" Untested. "Round 2 · plan": Ada North #1, Ada North #2 and Lineup · "Ada North Bea Lowe", all Kept. There is no separate "Ran in round 1" list. Matrix "2 ads · 2 × 1, 0 left out", button "Propose round 2". Strip: Round 1 judged |
| CL7 | Instagram candidates for Ada North | Once, under "Find clips on Instagram", ranked 1–4 by score: 1 ♥ 1,200 · 💬 40 · 8 days ago · 9:16, Request from team; 2 ♥ 800 · 💬 20 · 2 weeks ago · 4:5, "Skipped — text overlay"; 3 ♥ 400 · 💬 10 · 4 weeks ago · landscape, "Requested"; 4 ♥ 300 · 💬 5 · 1 day ago · 9:16, Add. Ages count from the fixture's now (6 Nov 2026) |

### Captions

Every fixture caption marked valid is run through `validateCaption` the way
the loader calls it (event facts, no ticket tiers), and must pass with the
lines the fixture shows (`lib/plan/__tests__/lab-frames.test.ts`). The live
loader passes no tiers, so no price can appear in primary text. Lineup:
"Ada North Bea Lowe / 12 December / Fixture Hall". POV: "POV: lights drop /
and Ada North / walks on" (first line 16 characters).

The overlay draws the stored lines exactly (rule 13): a box 8% in from
each side, `white-space: pre`, one block per stored line. For every CL
caption the runner checks that the lines drawn equal the lines stored and
that none is wider than the box; a mismatch fails the shot.

### Known gaps

- CL7: candidate frames are a placeholder box. Candidates store no
  thumbnail (`media_url` is never stored and there is no thumbnail
  column), so a real frame needs one stored at discovery.
- Add on a candidate stays disabled until M4b.

### Poster frames

Clip tiles and the caption overlay rest on their poster frame (0.5 s in,
or in_s). The seek runs in `onLoadedMetadata` and again in a mount effect
when metadata arrived before hydration (`use-clip-video.ts`). The runner
only watches: a visible video still at 0 s fails the shot.
