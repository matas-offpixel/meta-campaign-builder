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
| IR | Insights rail beside the event page and the MML canvas | per frame (record) | `rail-fixtures.ts` |

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

## IR series

The Insights rail (`docs/design-record/2026-11-07-insights-rail.html`) beside
a fixture page, with its data given instead of fetched. Every figure is a
literal tag_performance-shaped row in `rail-fixtures.ts`, and
`lib/insights-rail/model` builds the sections from them, so the frames show
what the model says and `lib/plan/__tests__/rail-frames.test.ts` asserts
the same figures. Launches off, no Supabase, no Meta.

| Id | Widths | State | What to check by hand |
|---|---|---|---|
| IR0 | — | DOM guard | The runner opens `/admin/fixture-client`, `/share/report/fixture-token` and `/l/fixture-client/fixture-event` and counts `[data-insights-rail], [data-insights-pill]`: 0 on each, whatever the page renders. The evidence index lists where each landed |
| IR1 | 1280 | Event page, rail collapsed | A 34 px tab reading "Insights ‹" down the right edge; the page keeps its width; Approve stays visible |
| IR2 | 1280, 393 | Puzzle on sale → Ticket sale; client thin | Caption angle, Hook and Visual format all fall back: "Puzzle has no ticket sales attributed to its ads in the last 90 days. Showing all clients." and "🔒 Across clients · Matas only". Angle: "Urgency / scarcity costs 25% less than usual." £34.92 25% under, £45.13 4% under, £47.36 1% over, £51.91 11% over (baseline £46.80 / purchase); "strong · 255+ funded ads · 90 days · all clients · £ / purchase"; Use Scarcity + "needs the ticket count that makes it true". Hook: "Social proof costs 54% less than usual." £21.47, £38.13, £42.22, £45.38, "+5 more". Visual: "Nostalgia costs 38% less than usual." £29.09, £41.38, £44.57, £62.90 34% over (brick), "+5 more". In the Lab last: "No round judged yet. Approve a caption and propose round 1." At 393 the same as a sheet at 86% with a scrim and ✕ |
| IR3 | 1280 | Rail only · Puzzle, Signup | Vertical disabled with "Vertical is off until the music rollup stops including other verticals." Angle: "No clear winner between Event announcement and Artist / headliner." £4.16 level, £4.17 level, £4.60 11% over (brick); "ok · 25+ funded ads · 90 days · this client · £ / signup". Hook: "No clear winner between FOMO and Curiosity." £4.16 level, £4.30 3% over, then "Urgency / Not enough data yet: 2 funded ads"; "strong · 49+ funded ads". Visual: "Headline costs 6% less than usual." £3.90 6% under (olive), £4.70 13% over (brick). No Use action |
| IR4 | 1280, 393 | MML canvas (plan fixture A1), campaign context | Context line "New Meta campaign · Puzzle · Signup · Leads". Best lines: "Lines are scored overnight. None are scored yet, so the first examples arrive after tonight's run." Proven elsewhere: "No line is proven yet. Proven lines appear here as chips you can drop into the copy." Then Caption angle (no clear winner), Visual format (Headline 6% under), Asset type: "Lifestyle image with text costs 7% less than usual." £3.85 7% under, £4.59 10% over, "UGC / Not enough data yet: 0 funded ads". No Use action off the event page. The Meta drawer itself is not in the frame: it loads its draft from the database |
| IR6 | 1280 | Rail only · CL6 Lab judged | "In the Lab · round 1 · judged" first: "Lineup captions beat POV by 33% on Off Pixel Fixtures." Lineup £0.50 · 40 signups (olive), POV £0.75 · 20 signups (brick); "Ada North #1 × Lineup" Winner; "round 1 · 60 signups · £35 spent"; Use Lineup |
| IR7 | 393 | Event page, collapsed | An "Insights ‹" pill in the header row beside the page's actions; no floating button; Approve visible |

The record's figures differ from the model's in one place: IR3's and IR4's
asset type reads 7% under (3.85 ÷ 4.16 = 0.9255), where the record rounded
to 8%. The record allows ±1 point.

Placeholders the record marks (top creatives, "Meta spent on x of y ads")
are omitted, not drawn (H10). Build 2 (the audience builder's clusters and
the TikTok drawer) is not here.
