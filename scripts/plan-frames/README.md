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
| AB | Asset bank on the event page, Today and the client Ticketing tab | 1280 and 393 | `bank-fixtures.ts`, `components/dashboard/asset-bank/` |
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
| CL3 | 2 clips, 1 proposed Lineup caption | Clips: Ada North #1 IG 0:18 (native 9:16) under "New · 1". Bea Lowe #1 file 0:24 is "Triple-fit only · 1", status "Landscape — triple-fit only", with "Make a triple-fit". Scrubbers span 0–18 s and 0–24 s, thumb at the 0.5 s poster. Feed post on Ada North #1: overlay "Ada North Bea Lowe / 12 December / Fixture Hall" on three lines; primary text "Ada North and Bea Lowe play Fixture Hall on 12 December."; headline "Fixture Night · 12 December · Fixture Hall" |
| CL4 | As CL3, primary text empty | The muted slot "No primary text yet — ✎ to add" in place of the primary text |
| CL5 | Round 1 proposed | 2 approved captions (Lineup, POV) × 3 clips = 6 pairings. The runner clicks Ada North #1 × POV off, so the line reads "5 ads · 3 × 2, 1 left out". "Round 1 · draft" lists those 5 pairings as "{artist} #{n} × {angle}", all Ready. Strip: Round 1 draft. No round has run, so there is no timeline |
| CL6 | Round 1 judged on signups | Ada North #1 × Lineup: Winner (olive), £0.50 / signup · 40 signups = £20.00. Bea Lowe #1 × POV: "cost 1.5× the usual" (brick), £0.75 / signup · 20 signups = £15.00 (0.75 ÷ 0.50 = 1.5). Ada North #2 × Lineup: Untested (dashed). Keeping 1, Triple-fit only 1, New 1. Bea's tile reads "Landscape — triple-fit only" with £0.75 / signup · 20 signups under it. What's working: "Lineup captions beat POV by 33% on Off Pixel Fixtures" ((0.75 − 0.50) ÷ 0.75 = 33.3%) and "Ada North clip #1 is the current winner". Next: "Round 1 is judged. Propose round 2." Timeline: "Round 1 · judged · £0.58 / signup" (£35 ÷ 60 = £0.583) lists its ads with chip and cost: "Ada North #1 × Lineup" Winner £0.50 / signup · 40 signups; "Bea Lowe #1 × POV" struck through, "cost 1.5× the usual" £0.75 / signup · 20 signups; "Ada North #2 × Lineup" Untested. "Round 2 · plan": Ada North #1, Ada North #2 and Lineup · "Ada North Bea Lowe", all Kept. There is no separate "Ran in round 1" list. Matrix "2 ads · 2 × 1, 0 left out", button "Propose round 2". Strip: Round 1 judged |
| CL7 | Instagram candidates for Ada North | Once, under "Find clips on Instagram", ranked 1–4. The same four as CL8. Posters are the VP9 fixture clips. 1 ▶ 0:18 · ♥ 1,200 · 💬 40 · 8 days ago · 9:16, Request from team; 2 ▶ 0:27 · ♥ 800 · 💬 20 · 2 weeks ago · 4:5, at 55% opacity, "Skipped — text in 3 of 8 frames · see" (see is closed); 3 ♥ 400 · 💬 10 · 4 weeks ago · landscape, at 55% opacity, Requested; 4 ▶ 0:14 · ♥ 300 · 💬 5 · 1 day ago · 9:16, Add. Ages count from the fixture's now (6 Nov 2026). Lengths are fixture-only: Instagram's listing does not return duration |
| CL8 | Why #2 was skipped | The same four candidates. #2 is open as a panel, not inside the tile: "Why #2 was skipped", "8 frames checked", eight frames of the fixture clip, frames 3, 4 and 6 marked Aa. "Text burned into 3 of 8 frames — it would read as someone else's ad." Import anyway is a text link under that sentence |
| CL9 | Landscape clip, crop closed | Bea Lowe #3, "Triple-fit only · 1", status "Landscape — triple-fit only", with "Make a triple-fit". The crop panel does not open |
| CL10 | Render rows | 2 of 3 ready. Each row's mini frame is that pairing's clip, including the Ready rows. Ready is an olive outline chip and the finished bars are olive. One row is at ~1 min. The failed row on Bea Lowe reads "The renderer failed · Landscape — triple-fit only" and has no retry. The finished render plays as a 9:16 preview beside the rows at 1280 and full width at 393, caption burned in |
| CL11 | Triple-fit offer, made tile, and plan rows | Ada has two 9:16 clips, so the header is "CLIPS 2 · 1 blocked" and "2 of 2 selected", and New is "New · 2 · untested". Ada North #15 reads "Landscape — triple-fit only" in muted ink, with a plain hairline and "Make a triple-fit". Ada's 640×360 stays "Too small for 9:16" in red. Bea Lowe #21 has no button because "Triple-fit · #21" is its own group, "Triple-fit · 1". That tile has no tick and reads "T1 only — not paired with captions". Under the card, a 956×718 video reads "Too small for 9:16" and a 1080×1350 video reads "Video runs as 9:16 only" |
| CL12 | Made triple-fit, fully in the row | No 9:16 clips, so nothing is selected. Ada North #15 is muted with a plain hairline. Ada's 640×360 is the red dashed "Too small for 9:16". "Triple-fit · #21" is the only tile in "Triple-fit · 1", fully visible at 393, with no tick and "T1 only — not paired with captions" |

## CLQ series

Quote mode, from fixtures. No Supabase, Meta, Lambda or Anthropic. The
words on the plates are the design record's stand-ins, not anything an
artist said. `only=CLQ` shoots these and leaves CL1–CL10 alone.

The record's annotation column
beside CLQ2 and CLQ4 is not part of the component. The 4:5 rect is two
full-width dashed lines at 14.84% from the top and the bottom, labelled
"4:5 rect · 14.84 %". The plate is a gradient, not a clip. The Instagram
dot is the record's `#B0607A` and the sponsored dot is the deck's meta
blue `#5B7FA6`, used on these frames only. Horizontal centre 0.5025,
font size 0.0193 H, the 70% wrap and the four-line cap are the record's
invented figures. Lines are the font's own wrap inside that width.
`quote_weight` and `artist_id` are columns the build list did not name:
the weight is the per-quote toggle, and `artist_id` keeps the words on
that artist's round.

| Id | State | What to check by hand |
|---|---|---|
| CLQ1 | Captions generator in quote mode | Title "Captions". Mode Quote. Artist Enzo Siragusa, with "✓ artist channels" at 1280 and the name only at 393. Source "A post". Post list, newest first: chip "● @enzosiragusa · 12 Oct" and the placeholder caption, with ↗ on the permalink; then "● @enzosiragusa · 2 Oct" greyed with "no caption on this post". No URL on the tile. The placeholder words. Source chip "● @enzosiragusa · post, 12 Oct" at 1280 and "● @enzosiragusa · 12 Oct" at 393. The line meter is the font wrap, "4 of 4 lines". Button "Use these words". At 393, More sits beside the button |
| CLQ2 | Quote feed post, Enzo cleared | Copy "Enzo Siragusa on the 4th Birthday, 27 Dec at Circuit." The stored lines, one nowrap block each, on the 4:5 plate in TikTok Sans. Four lines; the 🔥 ends line four. No stroke, no name. Chips: quote, the post chip, "Enzo · clip 3" (1280 only), "✓ Cleared — artist channels too · Matas, 6 Nov" at 1280 and "✓ artist channels · Matas, 6 Nov" at 393. ✎ ✕ ✓. Time 0:14. CTA Get tickets |
| CLQ4 | Luke Dean, promoter page only | Quote "Been waiting all year to play Circuit again. Bring the energy 👊". Held, the sentence "These are Luke Dean's own words, so they run only once they're cleared for their own channels." (no pronoun on the row), action "Clear for artist channels", no ✓. 1280 shows the copy line and the chips, then the sentence, then the action and ✎ ✕ at 40% on their own line. 393 has no copy line; the chip and the sentence stack and the action is full width. Time 0:09 |

## CLS series

Clip selection, from fixtures. No Supabase, Meta or Anthropic. `only=CLS` shoots
these and leaves CL, CLQ and CLV alone. CLS1 is the clip grid with a tick and
"4 of 9 selected". CLS2 is Pair with, including Each selected at 1280. CLS2b is
Each selected before a write: 4 clips, "3 captions × 4 clips = 12 previews",
and "Write to see these on the clips." CLS3 is
the round matrix narrowed to the selection, one pairing knocked out. CLS4 is
Finding…, Importing… and Writing… with the resting width held.

## CLA series

Clip audio, from fixtures. No Supabase. `only=CLA` shoots these. CLA1 is the clip
tiles, four with a preview, the first one unmuted (Volume2) and the rest muted
(VolumeX). CLA2 is a feed post and a finished render preview, each with the
muted toggle. The control sits 6 px from the left and 16 px up from the bottom.

## CLV series

Voice, from fixtures. No Supabase, Meta or Anthropic. `only=CLV` shoots
these and leaves CL and CLQ alone. Captions are the placeholders in
`docs/creative-lab/fixtures/voice-puzzle.json`. The four newest are the
record's stand-ins. The other twenty are invented in the same register so
`extractTraits` produces the sheet's counts: emoji 19 of 24, sign-off 9,
venue Circuit 11 and Circuit Southampton 0, hashtags 3 trailing, no em dash,
lineup 8, mentions 14, sentence case 24 of 24, median 7 words and about 140
characters. The sentence range on the sheet is 2–12. The drawing's
placeholder said 4–12; the verbatim line "Sold out." is two words, so the
extractor's minimum is 2. The four exemplar weekdays are the record's
labels (Thu 6 Nov, Sat 1 Nov, Thu 30 Oct, Fri 24 Oct), not the 2026 weekday
of those dates. Enzo's chip says 30 posts as drawn; his captions are not
on a sheet in these frames. The hashtag switch is client data, default
off, and is not drawn on CLV2.

Baselines: Ubuntu frames-baselines 42497321834 and 42497326107, matching, `only=CLV`.

| Id | State | What to check by hand |
|---|---|---|
| CLV1 | Generator, caption mode | The real VoicePanel. Two strips at 1280: Lineup "Sounds like @puzzle · 24 posts"; Artist, third person, "Sounds like @puzzle". 393 is the puzzle chip full width, "24 posts" on the right, why line "Promoter voice · read today 09:12" |
| CLV2 | Voice sheet | Traits from the fixture through the extractor, four exemplars verbatim, "+ 20 more", Read again. 393 is an 88% bottom sheet, fewer trait rows, two exemplars, "+ 22 more" |
| CLV3 | Nothing read | Dashed House voice chip and "No posts read yet — Find clips reads them." Sheet empty state with Find clips. 393 stacks the sentence under the chip |
| CLV4 | Artist, third person | Each strip reads the promoter page: "Sounds like @puzzle". The section labels stay (Empty feed, No handle, Read but stale). 393 is Luke's strip |

## CLW series

The caption follows the footage's owner. `only=CLW` shoots CLW1, CLW1b, CLW2 and CLW3, and leaves CL and CLV alone.

CLW1b baselines: Ubuntu frames-baselines 42898262157 and 42898272384, matching, `only=CLW1b`.

| Id | State | What to check by hand |
|---|---|---|
| CLW1 | Clips by owner | Puzzle footage first, empty, then Enzo and Luke. 393 stacks and shows Enzo #1 and #2 |
| CLW1b | Clips with candidates | The same section with eight Puzzle candidate tiles and Add on each, Find clips on @puzzle above the tiles, and no empty box. Enzo (5) and Luke (21) below. 393 is two tiles across |
| CLW2 | Generator | Angle row Lineup · Artist · POV · Scarcity. The Artist caption is the writer's wrap (default 18, four lines: "Luke Dean. Back" / "at Circuit" / "for Puzzle's" / "4th birthday.") centred on Luke #1's clip. An unpaired Lineup post and Luke's quote line. 393 is the unpaired post |
| CLW3 | Next | "Add Puzzle footage — 20 Lineup captions are waiting for it." 393 puts the button on its own line |

## AB series

Puzzle 4th Birthday, today 7 Nov 2026, show 27 Dec, payday Fri 27 Nov, 50 days. Four release dates: 21 Oct; 29 Oct 11:30/12:00; 30 Oct 12:00; 6 Nov 11:30/12:00. States sold out · sold out · on sale · selling fast. No counts.

| Id | What to check |
|---|---|
| AB1 | Dots sit on one line. Early bird: live done, sold out done. 2nd release: live → 90% sold out → sold out, all done. General sale and 3rd release show a dashed final X. The 3rd release's next rung is "90% · next read Mon" in ochre. Today sits above the release labels. Show · 27 Dec is one line. The state control is one bordered control: past segments muted, the current one filled ink. Big number 2 of 4 on sale · 2 sold out. 393 scrolls the line and shortens the control to fast / final / out |
| AB2 | The roll-call proposal and the payment-plan offer, then issue 2's four cards. 393 shows the roll-call, the offer, the proposal and the locked card. The offer card has no trigger line. |
| AB3 | 23 Nov – 27 Dec. Window shaded where `isInPaydayWindow` is true: Thu 26 Nov through Sun 13 Dec (18 days). 27 Nov and 24 Dec are outlined. Ticket pushes are brick, content-led pushes are meta-blue, and the legend has those swatches. 24 Dec reads "moved · 25th is Christmas". The 393 list includes Sat 28 and every other push on the grid. "Last day at £26" is gone |
| AB4 | Header 15 approved · 1 proposed · 3 locked · 5 missing. Made cells carry a thumbnail, approved cells add ✓, held is ochre-outlined, proposed is ochre, locked and "+ needs …" are dashed. Row sub-lines include "sold out · ladder done" and "proposed · Mon read". The button's action makes nothing |
| AB1b | A backfilled event. Two rows, Presale not yet and General sale on sale, outlined until a tap. |
| AB5 | Puzzle's ladder: fifteen rungs. Offers are a line in the right panel, not a rung. The 90% rung reads "Selling fast for 14+ days, no count" with the sub-line "the default". |
| AB6 | The Offers sheet, payment plan filled in (£10 today, 3 parts, until 27 Nov), and the same sheet refusing "final release". |

Flagged against the drawings:

- AB2's first line is "Client message, Wed 4 Nov:" (the vendor reader is not in this PR). The record's figure says "Skiddle read Wed 4 Nov 09:00".
- Artwork slots are a dashed "+ needs the piece". The figures use a filled caption; the overlay templates are not built, and this PR does not render.
- A made board cell uses the record's thumbnail gradient. There is no piece to show.
- AB3's record says the window runs to Monday 14 Dec. The code's 18th day is Sunday 13 Dec, so 14 Dec is not shaded. The verdict keeps the code.
- Content-led marks use the deck's meta-blue (`#5B7FA6`).
- AB4's visible cells do not add up to 15 approved. The header is the record's count.
- AB1's "Skiddle read" lines are the figure's provenance. Nothing fetches Skiddle.

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

- CL7 lengths (▶ 0:18 and the rest) are drawn for the frame only.
  Discovery does not store a duration. The thumbnail URL is never
  stored; the tile reads the object in creative-thumbnails.
- Add on a candidate with a file imports it. A candidate with no file stays Request from team.

### Poster frames

Clip tiles and the caption overlay rest on their poster frame (0.5 s in,
or in_s). The seek runs in `onLoadedMetadata` and again in a mount effect
when metadata arrived before hydration (`use-clip-video.ts`). The runner
only watches: a visible video still at 0 s fails the shot.

## IR series

The Insights rail (`docs/design-record/2026-11-07-insights-rail.html`, issue 2
`2026-11-08-insights-rail-2.html`) beside
a fixture page, with its data given instead of fetched. Every figure is a
literal tag_performance-shaped row in `rail-fixtures.ts`, and
`lib/insights-rail/model` builds the sections from them, so the frames show
what the model says and `lib/plan/__tests__/rail-frames.test.ts` asserts
the same figures. Launches off, no Supabase, no Meta.

| Id | Widths | State | What to check by hand |
|---|---|---|---|
| IR0 | — | DOM guard | The runner opens `/admin/fixture-client`, `/share/report/fixture-token` and `/l/fixture-client/fixture-event` and counts `[data-insights-rail], [data-insights-pill]`: 0 on each, whatever the page renders. The evidence index lists where each landed |
| IR1 | 1280 | Event page, rail collapsed | A 34 px tab reading "Insights ‹" down the right edge; the page keeps its width; Approve stays visible |
| IR2 | 1280, 393 | Puzzle on sale → Ticket sale; client thin (re-baselined in issue 2, R12/R13) | Caption angle, Hook, Visual format and Asset type all fall back: "Puzzle has no ticket sales attributed to its ads in the last 90 days. Showing all clients." and "🔒 Across clients · Matas only". Angle: "Urgency / scarcity costs 25% less than usual." £34.92 25% under, £45.13 4% under, £47.36 1% over, £51.91 11% over (baseline £46.86 / purchase); "strong · 225+ funded ads · 90 days · all clients · £ / purchase"; Use Scarcity + "needs the ticket count that makes it true". Hook: "Social proof costs 54% less than usual." £21.47, £38.13, £42.22, £45.38; "strong · 54+ funded ads · 90 days · all clients · +5 more". Visual: "Nostalgia costs 38% less than usual." Nostalgia £29.09 38% under (olive), Headline £41.38 12% under (olive), Billboard £44.57 5% under (ink), POV £57.57 23% over (brick); "strong · 15+ funded ads · 90 days · all clients · +3 more". Asset type: "Hybrid costs 30% less than usual." £32.81 30% under (olive), £42.21 10% under (olive), £48.28 3% over (ink), £52.61 12% over (brick); "strong · 10+ funded ads · 90 days · all clients · +1 more". In the Lab last: "No round judged yet. Approve a caption and propose round 1." At 393 the same as a sheet at 86% with a scrim and ✕ |
| IR3 | 1280 | Rail only · Puzzle, Signup | Vertical disabled with "Vertical is off until the music rollup stops including other verticals." Angle: "No clear winner between Event announcement and Artist / headliner." £4.16 level, £4.17 level, £4.60 11% over (brick); "ok · 25+ funded ads · 90 days · this client · £ / signup". Hook: "No clear winner between FOMO and Curiosity." £4.16 level, £4.30 3% over, then "Urgency / Not enough data yet: 2 funded ads"; "strong · 49+ funded ads". Visual: "Headline costs 6% less than usual." £3.90 6% under (olive), £4.70 13% over (brick). Asset type: "Lifestyle image with text costs 7% less than usual." £3.85 7% under, £4.59 10% over, "UGC / Not enough data yet: 0 funded ads". Then In the Lab. No Use action |
| IR4 | 1280, 393 | MML canvas (plan fixture A1), campaign context | Context line "New Meta campaign · Puzzle · Signup · Leads". Best copy shapes · All clients (ALL CLIENTS at both widths): "Puzzle has no copy shape with enough shows yet. Showing all clients." Rows sort cheapest first (R13), so the opener leads: "Opener: artist name costs 35% less than usual." Bars: "Opener: artist name · artist voice · undated" 0.65 · 35% under · "7 shows · 141 ads · registration"; "4+ lines · promoter voice · dated · a price" 0.75 · 25% under · "3 shows · 27 ads · ticket sale" (one ads hash, four facets); "1–2 emoji" 0.94 · 6% under · "4 shows · 38 ads"; "Countdown scarcity" 1.16 · 16% over · "3 shows · 22 ads". "ok · 22+ ads · 3+ shows · 90 days · all clients · +14 more". 🔒 line. Use shape · "artist voice → Angle: Artist, first person". Copy lines: "No line has run in two shows yet. Lines appear here, as chips you can drop into the copy, once one does." Then Caption angle, Visual format and Asset type as issue 1. The sheet drops the stage from the sub-line. The Meta drawer itself is not in the frame |
| IR9 | 1176 | Today stand-in, rail open as a drawer | Header "Today · Sun 8 Nov", "3 to approve · 2 reads due · 1 held", Insights › and Approve all 3 above the scrim. Context "Today · All clients · Signup". The drawer starts under the header; the content column does not narrow |
| IR5 | 1280, 393 | Audience builder · Puzzle · Signup; Vertical · music selected | Context line "Audience builder · Puzzle · Signup"; the Vertical toggle is on and reads "Vertical · music" (cluster verticals are the clusters' own column). Interest clusters · "music · signup": "Disc Genre costs 41% less than its clients' usual." Rows with Add cluster: Disc Genre "£1.06 / signup · 41% under · 8 funded ad sets · 2 clients · ok", Music festivals "£0.98 / signup · 33% under · 3 funded ad sets · 2 clients · ok", Latest iPhone users "£2.00 / signup · 8% under · 3 funded ad sets · 1 client · ok", Electronic music "£2.13 / signup · 2% under · 4 funded ad sets · 1 client · ok"; thin line "Melodic Techno, Fashion, Streaming, Streaming — full" / "Not enough data yet: 1–2 funded ad sets each"; "28 clusters not tried yet · show · picked 7 times so far"; 🔒 line. Lookalikes and retargeting · Puzzle: "Not measured yet. Appears once results are stored per audience (source, lookalike range, cost per result), from the next nightly run after that job ships." The page shows Disc Genre with the chip "added from Insights". At 393 the sheet; "picked 7 times" is hidden |
| IR6 | 1280 | Rail only · CL6 Lab judged | "In the Lab · round 1 · judged" first, then the four tag sections as IR3: "Lineup captions beat POV by 33% on Off Pixel Fixtures." Lineup £0.50 · 40 signups (olive), POV £0.75 · 20 signups (brick); "Ada North #1 × Lineup" Winner; "round 1 · 60 signups · £35 spent"; Use Lineup |
| IR7 | 393 | Event page, collapsed | An "Insights ‹" pill in the header row beside the page's actions; no floating button; Approve visible |
| IR8 | 1280, 393 | MML canvas (plan fixture A1), TikTok drawer context (?drawer=tt) | Context line "New TikTok campaign · Puzzle · Signup". Who clicks on TikTok · "Puzzle · 90 days": "No clear winner between 18–24 and 25–34." "18–24 · 9.3% watch past 2 s" £0.49 / click · level, "25–34 · 10.0% watch past 2 s" £0.50 / click · level, "35–44 / Not enough data yet: £7 spent, 13 clicks"; "ok · £109 spent · 218 clicks · 90 days · Puzzle · TikTok". Who watches: "Men watch past 2 s 8% more than usual." Men 10.5% · 8% over (olive), Women 9.2% · 6% under (brick); "ok · 2-s views ÷ impressions · 55,111 impressions · 90 days · Puzzle · TikTok". Then the ochre line "TikTok ads aren't tagged yet. These angles, hooks and formats come from Puzzle's Meta ads; the costs are Meta costs." and Caption angle, Hook, Visual format with the kicker "from Meta ads" and confidence lines ending "· Puzzle · Meta" (angle also "· £ / signup"), as IR3 draws them: no clear winner, "No clear winner between FOMO and Curiosity.", "Headline costs 6% less than usual." No Asset type, no interest category, no region, no Use action: exactly five sections. The TikTok drawer itself is not in the frame: it loads its draft from the database. At 393 the sheet |

## IR sources

Every `row(...)`, `cluster(...)` and `tt(...)` in `rail-fixtures.ts` is on one of
the tables below with where its figures came from.
`lib/plan/__tests__/rail-sources.test.ts` reads the fixture and fails on any
row whose cells are not together on one line here.

Sources: **R2** = record IR2 bars (issue 1; all clients · ticket sale · 7 Nov);
**R3** = record IR3 table (issue 1; Puzzle · registration); **DN2** = issue 2's
data note (`2026-11-08-insights-rail-2.html`): tag_performance, scope all ·
ticket_sale · 7 Nov, baseline £46.86 / purchase, stored shrunk indexes and
funded counts; **LE** = the same data note's `interest_clusters.live_evidence`
rows, confirmed by a read-only query of production on 7 Nov (36 clusters, 8
with spend, 28 untried, use_count Σ 7); **TB** = `tiktok_breakdown_snapshots`,
Puzzle's two events' latest windows summed, read-only on 7 Nov (the data
note prints the same sums rounded: £66 / 134 / 9.3 %, £36 / 71 / 10.0 %, £7 /
13; women 9.2 % of 31,257, men 10.5 % of 23,854); **min** = the record prints
only the section's confidence-line minimum, so every row carries that
minimum; **hidden** = a row beyond the four bars, present only for the
record's "+n more", never drawn.

### Tag rows (IR1–IR4, IR6–IR8)

| Dimension | Value key | £ / result | Baseline | Shrunk | Confidence | Funded | Source |
|---|---|---|---|---|---|---|---|
| messaging_angle | event_announcement_update | 4.16 | 4.16 | 1.0 | ok | 25 | R3; funded min |
| messaging_angle | artist_headliner | 4.17 | 4.16 | 1.0 | ok | 25 | R3; funded min |
| messaging_angle | high_energy_atmosphere | 4.6 | 4.16 | 1.11 | ok | 25 | R3; funded min |
| hook_tactic | fomo | 4.16 | 4.16 | 1.0 | strong | 49 | R3; funded min |
| hook_tactic | curiosity | 4.3 | 4.16 | 1.03 | strong | 49 | R3 cpr; funded min; shrunk is the raw 4.30 ÷ 4.16 stand-in: issue 1 printed 0.98 against a cpr 3% over baseline, and a stand-in index must agree with its own cpr (#1110 verdict item 4), so FOMO (1.0) draws first |
| hook_tactic | urgency | null | 4.16 | null | thin | 2 | R3 (thin, 2 funded) |
| visual_format | headline | 3.9 | 4.16 | 0.94 | ok | 21 | R3; funded min |
| visual_format | cinematic_b_roll | 4.7 | 4.16 | 1.11 | ok | 21 | R3; funded min |
| asset_type | lifestyle_image_with_text | 3.85 | 4.16 | 0.92 | ok | 25 | R3; funded min |
| asset_type | high_production | 4.59 | 4.16 | 1.07 | ok | 25 | R3; funded min |
| asset_type | ugc | null | 4.16 | null | thin | 0 | R3 (thin, 0 funded) |
| messaging_angle | artist_headliner | null | 46.86 | null | thin | 0 | record data note: Puzzle ticket_sale all thin; count not published; never drawn |
| hook_tactic | fomo | null | 46.86 | null | thin | 0 | record data note: Puzzle ticket_sale all thin; count not published; never drawn |
| visual_format | headline | null | 46.86 | null | thin | 0 | record data note: Puzzle ticket_sale all thin; count not published; never drawn |
| asset_type | high_production | null | 46.86 | null | thin | 0 | record data note: Puzzle ticket_sale all thin; count not published; never drawn |
| messaging_angle | urgency_scarcity_fomo | 34.92 | 46.86 | 0.755 | strong | 255 | DN2 (stored index and funded count as printed; cpr from R2) |
| messaging_angle | event_announcement_update | 45.13 | 46.86 | 0.964 | strong | 624 | DN2 (stored index and funded count as printed; cpr from R2) |
| messaging_angle | artist_headliner | 47.36 | 46.86 | 1.011 | strong | 591 | DN2 (stored index and funded count as printed; cpr from R2) |
| messaging_angle | high_energy_atmosphere | 51.91 | 46.86 | 1.103 | strong | 225 | DN2 (stored index and funded count as printed; cpr from R2) |
| hook_tactic | social_proof | 21.47 | 46.86 | 0.543 | strong | 54 | DN2 (stored index and funded count as printed; cpr from R2) |
| hook_tactic | curiosity | 38.13 | 46.86 | 0.814 | strong | 121 | DN2 (cpr from R2; stored index for this row unpublished, so raw cpr ÷ baseline stands in; funded as DN2 prints) |
| hook_tactic | fomo | 42.22 | 46.86 | 0.901 | strong | 444 | DN2 (cpr from R2; stored index for this row unpublished, so raw cpr ÷ baseline stands in; funded as DN2 prints) |
| hook_tactic | urgency | 45.38 | 46.86 | 0.97 | strong | 255 | DN2 (stored index and funded count as printed; cpr from R2) |
| hook_tactic | hidden_hook_1 | 45.39 | 46.86 | 0.971 | strong | 54 | hidden (DN2 hook: 9 non-thin, 4 drawn, so 5 more with index ≥ 0.970; cpr and funded unpublished, never drawn) |
| hook_tactic | hidden_hook_2 | 45.4 | 46.86 | 0.971 | strong | 54 | hidden (DN2 hook: 9 non-thin, 4 drawn, so 5 more with index ≥ 0.970; cpr and funded unpublished, never drawn) |
| hook_tactic | hidden_hook_3 | 45.41 | 46.86 | 0.971 | strong | 54 | hidden (DN2 hook: 9 non-thin, 4 drawn, so 5 more with index ≥ 0.970; cpr and funded unpublished, never drawn) |
| hook_tactic | hidden_hook_4 | 45.42 | 46.86 | 0.971 | strong | 54 | hidden (DN2 hook: 9 non-thin, 4 drawn, so 5 more with index ≥ 0.970; cpr and funded unpublished, never drawn) |
| hook_tactic | hidden_hook_5 | 45.43 | 46.86 | 0.971 | strong | 54 | hidden (DN2 hook: 9 non-thin, 4 drawn, so 5 more with index ≥ 0.970; cpr and funded unpublished, never drawn) |
| visual_format | nostalgia | 29.09 | 46.86 | 0.773 | strong | 15 | DN2 (stored index and funded count as printed; cpr from R2) |
| visual_format | headline | 41.38 | 46.86 | 0.886 | strong | 396 | DN2 (stored index and funded count as printed; cpr from R2) |
| visual_format | billboard | 44.57 | 46.86 | 0.964 | strong | 27 | DN2 (stored index and funded count as printed; cpr from R2) |
| visual_format | pov | 57.57 | 46.86 | 1.186 | strong | 43 | DN2 (stored index and funded count as printed; cpr from R2) |
| visual_format | celebrity | 66.77 | 46.86 | 1.324 | strong | 15 | DN2 ("+3 more": cpr and stored index as printed); funded unpublished, the drawn minimum 15 stands in; hidden, never drawn |
| visual_format | cinematic_b_roll | 62.9 | 46.86 | 1.33 | strong | 15 | DN2 ("+3 more": cpr and stored index as printed); funded unpublished, the drawn minimum 15 stands in; hidden, never drawn |
| visual_format | listicle | 72.25 | 46.86 | 1.413 | strong | 15 | DN2 ("+3 more": cpr and stored index as printed); funded unpublished, the drawn minimum 15 stands in; hidden, never drawn |
| asset_type | hybrid | 32.81 | 46.86 | 0.85 | strong | 10 | DN2 (stored index and funded count as printed; cpr from R2) |
| asset_type | lifestyle_image_with_text | 42.21 | 46.86 | 0.903 | strong | 445 | DN2 (stored index and funded count as printed; cpr from R2) |
| asset_type | ugc | 48.28 | 46.86 | 1.029 | strong | 153 | DN2 (stored index and funded count as printed; cpr from R2) |
| asset_type | high_production | 52.61 | 46.86 | 1.114 | strong | 127 | DN2 (stored index and funded count as printed; cpr from R2) |
| asset_type | illustration | 118.95 | 46.86 | 2.36 | ok | 10 | DN2 (stored index 2.360, cpr £118.95); confidence and funded unpublished, Hybrid's used; hidden, never drawn |

Where DN2 prints no stored index (Curiosity, FOMO), the raw index stands in
and is marked. IR3's Curiosity row is the stand-in (`raw: true` on that
fixture row, R17): its stored index is the raw 4.30 ÷ 4.16 = 1.03 (R18).
Billboard's stored 0.964 now draws ink and POV (1.186) is the
fourth visual bar, as R12 corrects. The funded count on the confidence line
is the minimum of the four drawn rows (R12d): angle 225, hook 54, visual 15,
asset 10.

The record's figures differ from the model's in one place: IR3's and IR4's
asset type reads 7% under (3.85 ÷ 4.16 = 0.9255), where the record rounded
to 8%. The record allows ±1 point.

### Cluster rows (IR5)

Columns are the fixture's: name, the cluster's own vertical, £ / signup,
cprIndex (the % drawn is 1 − cprIndex), funded ad sets, clients,
confidence, use_count, ad sets (0 = never tried).

| Name | Vertical | £ / signup | cprIndex | Funded | Clients | Confidence | use_count | Ad sets | Source |
|---|---|---|---|---|---|---|---|---|---|
| Disc Genre | music | 1.06 | 0.59 | 8 | 2 | ok | 0 | 12 | LE (data note row; live_evidence 7 Nov) |
| Music festivals | music | 0.98 | 0.67 | 3 | 2 | ok | 0 | 3 | LE (data note row; live_evidence 7 Nov) |
| Melodic Techno | music | 1.44 | 0.77 | 1 | 1 | thin | 0 | 1 | LE (data note row; live_evidence 7 Nov) |
| Fashion | music | 2.22 | 0.9 | 2 | 2 | thin | 0 | 2 | LE (data note row; live_evidence 7 Nov) |
| Latest iPhone users | music | 2.0 | 0.92 | 3 | 1 | ok | 0 | 5 | LE (data note row; live_evidence 7 Nov) |
| Electronic music | music | 2.13 | 0.98 | 4 | 1 | ok | 0 | 4 | LE (data note row; live_evidence 7 Nov) |
| Streaming — full | music | 0.96 | 1.03 | 2 | 2 | thin | 0 | 3 | LE (data note row; live_evidence 7 Nov) |
| Streaming | music | 2.24 | 1.03 | 2 | 1 | thin | 0 | 4 | LE (data note row; live_evidence 7 Nov) |
| Arsenal | football | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Artists — Business Techno | music | null | null | 0 | 0 | thin | 3 | 0 | LE (untried; use_count 3 of the Σ 7 the data note prints) |
| Artists — EDM | music | null | null | 0 | 0 | thin | 2 | 0 | LE (untried; use_count 2 of the Σ 7 the data note prints) |
| Artists — Genres | music | null | null | 0 | 0 | thin | 1 | 0 | LE (untried; use_count 1 of the Σ 7 the data note prints) |
| Artists — Melodic | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Artists — Metal | music | null | null | 0 | 0 | thin | 1 | 0 | LE (untried; use_count 1 of the Σ 7 the data note prints) |
| Artists — POP ARTISTS | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Artists — Punk | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Artists — Trance | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Artists — Trance Genre | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Deep house | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Festival Commercial | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Festivals Venues — Headsy / Wide Ranging | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Festivals Venues — Tech House | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Football interests | football | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Football Prospecting | football | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| High end jewellers | lifestyle | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Lifestyle | lifestyle | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Luxury | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Other — Commercial Radio | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Other — Radio | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Other — Record Shops | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Other — Wide radio | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Other — Wider Electronic | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Prospecting - Fashionistas | lifestyle | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Prospecting - Luxury fashion | lifestyle | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Publications | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |
| Radio + music news | music | null | null | 0 | 0 | thin | 0 | 0 | LE (untried) |

### TikTok rows (IR8)

Puzzle at Circuit (window 18 Aug – 24 Oct) + Puzzle 4th Birthday (28 Oct –
7 Nov), each event's latest window per value, summed. `NONE` values are
dropped by the reader.

| Dimension | Value | £ spent | Clicks | Impressions | 2-s views | Source |
|---|---|---|---|---|---|---|
| age | AGE_18_24 | 66.3 | 134 | 35857 | 3317 | TB: 66.26 + 0.04, 133 + 1, 35,839 + 18, 3,316 + 1 → £0.49 / click, 9.3 % |
| age | AGE_25_34 | 35.57 | 71 | 16558 | 1654 | TB: 35.56 + 0.01, 71 + 0, 16,539 + 19, 1,653 + 1 → £0.50 / click, 10.0 % |
| age | AGE_35_44 | 6.69 | 13 | 2704 | 385 | TB: 6.69 + 0.00, 13 + 0, 2,703 + 1, 385 + 0 → thin |
| gender | FEMALE | 61.54 | 128 | 31257 | 2861 | TB: 61.53 + 0.01, 127 + 1, 31,243 + 14, 2,859 + 2 → 9.2 % of 31,257 |
| gender | MALE | 47.0 | 90 | 23854 | 2494 | TB: 46.96 + 0.04, 90 + 0, 23,830 + 24, 2,494 + 0 → 10.5 % of 23,854 |

Placeholders the record marks (top creatives, "Meta spent on x of y ads",
the IR5 page's "3 audiences in this draft") are omitted or drawn as
placeholders, not as data (H10). The TikTok thin threshold (fewer than 20
clicks or under £10; under 1,000 impressions for a rate) and the ±5 % level
band are build choices the record leaves open; both are one-line constants
in `lib/insights-rail/model.ts`.

