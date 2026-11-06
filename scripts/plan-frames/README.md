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
| CL1 | Empty event, no facts, no ad set | Strip 0 · 0 · 0 · —; "Next: Add the lineup."; "headliners not set"; "No lineup yet." |
| CL2 | Lineup only | 5 artists, 3 starred (Ada North, Bea Lowe, Cal Reyes). Ada cleared ("Matas, 2 Nov"); the other four read "Promoter page only". Of the two Lab artists, Ada is cleared and Bea is promoter page only. Row verbs: Ada, Bea Find clips; Cal Clear for artist channels; Dee Add Instagram; Eli none |
| CL3 | 2 clips, 1 proposed Lineup caption | Clips: Ada North #1 IG 0:18 (native 9:16), Bea Lowe #1 file 0:24 (landscape, centre-cropped). Feed post on Ada North #1 (native wins the lead): overlay "Ada North / Bea Lowe / 12 December / Fixture Hall" on four lines; primary text "Ada North and Bea Lowe play Fixture Hall on 12 December. Tickets from £15."; headline "Fixture Night · 12 December · Fixture Hall" |
| CL4 | As CL3, primary text empty | The muted slot "No primary text yet — ✎ to add" in place of the primary text |
| CL5 | Round 1 proposed | 2 approved captions (Lineup, POV) × 3 clips = 6 pairings. The runner clicks Ada North #1 × POV off, so the line reads "5 ads · 3 × 2, 1 left out". The draft round holds those 5 pairings, all Ready |
| CL6 | Round 1 judged on signups | Ada North #1 × Lineup: Winner, £0.50 / signup × 40 = £20.00. Bea Lowe #1 × POV: "cost 1.5× the usual", £0.75 / signup × 20 = £15.00 (0.75 ÷ 0.50 = 1.5). Ada North #2 × Lineup: Untested. Keeping 2, New 1. What's working: "Lineup captions beat POV by 33% on Off Pixel Fixtures" ((0.75 − 0.50) ÷ 0.75 = 33.3%) and "Ada North clip #1 is the current winner" |
| CL7 | Instagram candidates for Ada North | Three, by score 0.9 / 0.6 / 0.3: 2026-10-30 9:16 ♥ 1200 · 💬 40 (candidate, "Request from team"), 2026-10-21 4:5 ♥ 800 · 💬 20 (skipped), 2026-10-12 landscape ♥ 400 · 💬 10 (requested). Shown under Ada's lineup row and in "Find clips on Instagram" |

### What the component shows that the brief did not ask for

These are how the current components render, not fixture choices. They are
for the design verdict, not fixed here:

- CL7: the candidate cards show no rank number, and every card carries the
  "Skipped — text overlay" placeholder and a disabled Add, including the
  one that is not skipped. Dates show as stored (2026-10-30). The same
  candidates are listed twice: under the lineup row and in the card row.
- CL5: "Ran in round 1" lists the draft round's pairings as "— / result ·
  Holding" before anything has run.
- CL6: the round list shows the raw verdict word ("winner", "flagged",
  "untested") where the clip tiles show the chip label.
- Clip tiles: the scrubber spans 0–0.1 s when a clip has no out point, not
  the part that runs (the design rules' Clip tile row says first 30 s at
  most).
- Clip tiles and the caption overlay seek to their poster frame in
  `onLoadedMetadata`. When metadata arrives before hydration that never
  runs, and the live page shows frame 0 (black for a fade-in). The runner
  fires the event again after hydration so the shot is stable.
