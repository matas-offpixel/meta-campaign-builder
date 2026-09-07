# Plan v2 overnight report — 2026-09-06

Off `main` `ad5beb2`. Three PRs, open, not merged. #907 (round 4, the last live defect) was already on `main` — skipped.

| PR | Number | Branch | State |
|---|---|---|---|
| B frames | [#908](https://github.com/matas-offpixel/meta-campaign-builder/pull/908) | `cursor/plan-v2-frame-screenshots` | open |
| C canon | [#909](https://github.com/matas-offpixel/meta-campaign-builder/pull/909) | `cursor/plan-v2-canon-live-walk-amendments` | open |
| D G35 | [#910](https://github.com/matas-offpixel/meta-campaign-builder/pull/910) | `cursor/plan-v2-schema-drift-172` | draft `[needs migration apply]` |

Person test (Matas, in Chrome), Junction 2 ticket finals, and any new state were not in this sprint.

## Frame-diff list (from #908)

The baseline is the first honest render. The canvas is the reference.

| Frame | Difference |
|---|---|
| All | Harness title line (`L1 · …`) is not on the canvas. List chrome (`Search` / `New plan from template` / `+ new plan`) is the live `/plans` surface; the canvas list has no that bar. |
| All ADJUST/LAUNCH | Usual signup line is **£1.32** (windowed view, G34). Canvas still draws lifetime **£2.03**. |
| E1 E6 | Next-time is **£1.10** (windowed + this plan). Canvas E1 is **£1.75**. Sentence unit follows stored `target_unit` (`per click` on D.O.D) not the phase word `per signup`. |
| A4 | Chip shows the operator target **£2.03** with usual **£1.32** under it. Canvas treats £2.03 as the line. |
| L1 | Empty is `no plans yet` in a dashed box, plus the `+ new plan` button. Canvas is the dashed empty row + `new plan` only. |
| L3 | Default tab is `drafts` (3 rows). D.O.D `running` sits on the other tab. Canvas draws all four mixed in one list. Fold is `Jamie Jones: 6 things to fix before you can launch` (live-walk wording). |
| L3-768 J2-768 | Same copy as 1176; column stacks. Canvas 768 fold/`do it` at 44px not re-checked pixel-for-pixel here. |
| A1 | Starting point **£1.60** matches. Identity prints `ELECTRIC STUDIOS SHEFFIELD` (resolved name), not the id form the canvas substituted. Unset moments are one line under the rail. |
| A2 | East End Dubs as at Tue 4 Aug (v3 reassignment). Dashed `from 1 other show`. |
| A6 | Folamour as at Tue 1 Sep. Presale is the missing-moments line, not a dashed tick on the rail. |
| A8 | On-sale reading is *per purchase*. Tickets still `not entered yet`. |
| A9 | Header is `Brand Awareness (Always-On)`. No presale/gen-sale moments. |
| A10 | Junk window: rail empty, `set start and end`. |
| A11 | TikTok unconnected with share > 0. Identity has `connect`. |
| A13 A14 A15 | Hard Techno as at Fri 24 Jul. Start 10 Jul vs now 24 Jul is a junk window (`set start and end`) — canvas draws a valid Jul–Aug rail. A14 row is `needs you` on TikTok; button line is `set start and end` (junk wins over the 6 TikTok blockers). Identity is `act_1073273492854557` (no name map). |
| J0 | Skeleton under the rail, no reading words. Header still names D.O.D and `live · launched`. Canvas J0 is the whole face as bars. |
| J1 | Day 0, `no reads yet`, nothing coloured. |
| J2 | `end · now` once; end handle `end not set`. Signup **£0.51 · your usual £1.32**. `Meta says £35 per purchase` (16 on £558) vs canvas **£33.56**. Tickets empty is the `£—` chip only when there is no Meta purchase line. |
| J3 | Under pace, cost above the line. Hard Techno. |
| J5 | Modern Funktion as at 4 Aug. Sparkline 5.14 · 3.71 · 2.83. Suggestion present. |
| J7 | Jamie Jones, no usual line, sentence `no usual yet`. |
| J8 | `Meta says 2,656 purchases · tickets 558 · 2,098 unexplained`. `£—` chip still stands beside the purchase sentence. Show is in-window (20 Apr); a second `◐ now · sho…` still clips at the right — leftover join when now sits on end. |
| J9 | `Meta says 1,086 · our tag: not measured` + `dod-newcastle.com`. |
| J12 | TikTok `0` results on 29% of spend, solid. |
| J14 | Log row in past tense with undo until the next check. |
| J18 | Refusal `Disco Pages` + `36 ad sets left alone`. |
| J19 | Creative block `no reads since Tue 26 Aug`. |
| J22 | J2 as `role=client`: suggestion/undo stripped, log kept. |
| E1 | Column heads match. Pace `£35 per day, kept`. Extrapolation title is on the frame. Next-time band is windowed, not £1.04–£2.10. |
| E2 | Actual only + `no prediction was stored for this plan`. |
| E3 | Three exhibits locked, `opens when D.O.D closes`. |
| E6 | E1 without the next-time column under `role=client`. |

## Contradictions needing a ruling

- **G34** — canvas lifetime £2.03 / E1 £1.75 vs windowed £1.32 / next-time £1.10. The render follows the view.
- **A13–A15 window** — a start more than a day in the past is junk on the live rail; the canvas still draws those frames as a valid window.
- **J8 `now · sho…`** — show is inside the window, now sits on end; the now-mark still joins show at the right. Round 4 hid now only when a moment is *outside* the window.
- **CI raster** — baselines were captured on macOS Chromium. Ubuntu `frames:check` may fail at 0.2% on system-ui antialiasing. If it does, regenerate on the CI image; do not loosen the tolerance to hide a face change.

## Next

A state that is not on the canvas is a frame first. Person test is Matas, in Chrome.
