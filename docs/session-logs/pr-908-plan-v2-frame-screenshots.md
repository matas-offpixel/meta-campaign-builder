# Session log

## PR

- **Number:** 908
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/908
- **Branch:** `cursor/plan-v2-frame-screenshots`

## Summary

Screenshot harness so a face PR cannot merge with the screen wrong. Rebased onto `main` `9218c2f`. Ubuntu Chromium (Playwright 1.63.0 / r1243) is the raster truth at 0.2%. Three overnight contradictions applied: G34 shape values, A13–A15 `now` = Wed 18 Mar, rail marks within 2% collapse (J8 `end · now · show`).

## Scope / files

- `scripts/plan-frames/` — fixtures, `--local` vs CI check, Playwright pin
- `app/(dev)/frames/[id]` — gated by `ENABLE_PLAN_FRAMES`
- `components/plan/plan-frame-mount.tsx` · `plan-workspace.tsx` · canvas window/target/adjust
- `lib/viz/window-bar.ts` — 2% cluster, rail-order nouns, newest glyph
- `docs/frames/` — Ubuntu baselines
- `.github/workflows/ci.yml` + `frames-baselines.yml`
- G34 one line on the canon

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5342 pass, 4 skipped)
- [x] `frames:check` on Ubuntu CI — [run 34116575904](https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/34116575904), all 36 `ok` (Diff frames ~16s after server up)

## Notes

`frames:check` is the CI truth. `npm run frames -- --local` writes `docs/frames/local/` for looking, not asserting. Do not loosen 0.2%. A13–A15 are valid windows as at Wed 18 Mar. J8 handle is `end · now · show`. `next start` must inherit stdio (a piped stdout deadlocked the Ubuntu check).

## Frame-diff list — next round (do not hide)

| Frame | Difference |
|---|---|
| All | Harness title line (`L1 · …`) is not on the canvas. List chrome (`Search` / `New plan from template` / `+ new plan`) is the live `/plans` surface; the canvas list has no that bar. |
| All ADJUST/LAUNCH | Usual signup line is **£1.32** (windowed view, G34). Canvas still draws lifetime **£2.03**. Ruled: render follows the view; £2.03 / £1.75 are shape values. |
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
| A13 A14 A15 | As at Wed 18 Mar — this PR: fixture `now` is that date, window is valid. Remaining copy/layout diffs stay for the next round. |
| J0 | Skeleton under the rail, no reading words. Header still names D.O.D and `live · launched`. Canvas J0 is the whole face as bars. |
| J1 | Day 0, `no reads yet`, nothing coloured. |
| J2 | `end · now` once; end handle `end not set`. Signup **£0.51 · your usual £1.32**. `Meta says £35 per purchase` (16 on £558) vs canvas **£33.56**. Tickets empty is the `£—` chip only when there is no Meta purchase line. |
| J3 | Under pace, cost above the line. Hard Techno. |
| J5 | Modern Funktion as at 4 Aug. Sparkline 5.14 · 3.71 · 2.83. Suggestion present. |
| J7 | Jamie Jones, no usual line, sentence `no usual yet`. |
| J8 | This PR: `end · now · show` (three marks within 2%). `Meta says 2,656 purchases · tickets 558 · 2,098 unexplained`. `£—` chip still stands beside the purchase sentence. |
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

Do not merge.
