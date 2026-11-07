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
| CL3 | 2 clips, 1 proposed Lineup caption | Clips: Ada North #1 IG 0:18 (native 9:16), Bea Lowe #1 file 0:24 (landscape, centre-cropped), both dashed Untested chips under "New · 2". Bea's tile says "Crop to 9:16". Scrubbers span 0–18 s and 0–24 s, thumb at the 0.5 s poster. Feed post on Ada North #1: overlay "Ada North Bea Lowe / 12 December / Fixture Hall" on three lines; primary text "Ada North and Bea Lowe play Fixture Hall on 12 December."; headline "Fixture Night · 12 December · Fixture Hall" |
| CL4 | As CL3, primary text empty | The muted slot "No primary text yet — ✎ to add" in place of the primary text |
| CL5 | Round 1 proposed | 2 approved captions (Lineup, POV) × 3 clips = 6 pairings. The runner clicks Ada North #1 × POV off, so the line reads "5 ads · 3 × 2, 1 left out". "Round 1 · draft" lists those 5 pairings as "{artist} #{n} × {angle}", all Ready. Strip: Round 1 draft. No round has run, so there is no timeline |
| CL6 | Round 1 judged on signups | Ada North #1 × Lineup: Winner (olive), £0.50 / signup · 40 signups = £20.00. Bea Lowe #1 × POV: "cost 1.5× the usual" (brick), £0.75 / signup · 20 signups = £15.00 (0.75 ÷ 0.50 = 1.5). Ada North #2 × Lineup: Untested (dashed). Keeping 2, New 1. What's working: "Lineup captions beat POV by 33% on Off Pixel Fixtures" ((0.75 − 0.50) ÷ 0.75 = 33.3%) and "Ada North clip #1 is the current winner". Next: "Round 1 is judged. Propose round 2." Timeline: "Round 1 · judged · £0.58 / signup" (£35 ÷ 60 = £0.583) lists its ads with chip and cost: "Ada North #1 × Lineup" Winner £0.50 / signup · 40 signups; "Bea Lowe #1 × POV" struck through, "cost 1.5× the usual" £0.75 / signup · 20 signups; "Ada North #2 × Lineup" Untested. "Round 2 · plan": Ada North #1, Ada North #2 and Lineup · "Ada North Bea Lowe", all Kept. There is no separate "Ran in round 1" list. Matrix "2 ads · 2 × 1, 0 left out", button "Propose round 2". Strip: Round 1 judged |
| CL7 | Instagram candidates for Ada North | Once, under "Find clips on Instagram", ranked 1–4. Posters are the VP9 fixture clips. 1 ▶ 0:18 · ♥ 1,200 · 💬 40 · 8 days ago · 9:16, Request from team; 2 ▶ 0:27 · ♥ 800 · 💬 20 · 2 weeks ago · 4:5, "Skipped — text overlay"; 3 ♥ 400 · 💬 10 · 4 weeks ago · landscape, Requested; 4 ▶ 0:14 · ♥ 300 · 💬 5 · 1 day ago · 9:16, Add. Ages count from the fixture's now (6 Nov 2026). Lengths are fixture-only: Instagram's listing does not return duration |
| CL8 | Why #1 was skipped | "Text burned into 3 of 8 frames". Eight frames, three flagged (frames 3, 4 and 6 marked Aa). Import anyway |
| CL9 | Crop picker on the landscape fixture clip | Bea Lowe's 16:9 clip. The window sits at 0.5. A six-frame filmstrip shows the same window. Use this crop |
| CL10 | Render rows | 2 of 3 ready. One row is at ~1 min. The finished one is playing |

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
| IR4 | 1280, 393 | MML canvas (plan fixture A1), campaign context | Context line "New Meta campaign · Puzzle · Signup · Leads". Best lines: "Lines are scored overnight. None are scored yet, so the first examples arrive after tonight's run." Proven elsewhere: "No line is proven yet. Proven lines appear here as chips you can drop into the copy." Then Caption angle (no clear winner), Visual format (Headline 6% under), Asset type: "Lifestyle image with text costs 7% less than usual." £3.85 7% under, £4.59 10% over, "UGC / Not enough data yet: 0 funded ads". No Use action off the event page. The Meta drawer itself is not in the frame: it loads its draft from the database |
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
and is marked; Billboard's stored 0.964 now draws ink and POV (1.186) is the
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

