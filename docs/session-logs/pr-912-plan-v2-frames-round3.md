# Session log

## PR

- **Number:** 912
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/912
- **Branch:** `cursor/plan-v2-frames-round3`

## Summary

Close #911's remaining render-vs-v3 gaps: `per ticket` as the display word for the `tickets_sold` line of the purchase unit (stored `target_unit` stays `purchase`), one chip + Meta-says line on J3/J8, J7 venue verbatim, A13 start/end labels clustered when they collide. E1 next-time £1.10 is ratified (G34) — no change.

## Scope / files

- `lib/viz/tokens.ts` — `VIZ_UNIT_WORD.ticket`
- `lib/plan/adjust-face.ts` · `launch-face.ts` — reading-unit resolver, ticket chip + Meta-says line
- `lib/viz/window-bar.ts` · `components/viz/window-bar.tsx` — 2% cluster includes start/end; overlapping handle labels collapse to one rail-order noun
- `components/plan/plan-workspace.tsx` · `plan-frame-mount.tsx` — benchmark unit follows the reading resolver
- `scripts/plan-frames/fixtures.ts` — J3/J8 ticket benchmark rows
- `docs/CAMPAIGN_PLAN_V2_CANON_2026-09-05.md` — §2.2 D ticket-word amendment

## Validation

- [x] `npx tsc --noEmit` (our files; repo-wide jest test files still fail as on main)
- [x] `npm run build` (via frames-baselines [34128525617](https://github.com/matas-offpixel/meta-campaign-builder/actions/runs/34128525617))
- [x] `npm test` (5353 pass, 4 skipped)
- [ ] `frames:check` on Ubuntu CI — baselines A13 A14 J3 J8 from that run

## Notes

**E1 next-time £1.10 — ratified (G34).** The render is right. The canvas's £1.75 is a shape value. No code change this round.

**A13 before/after.** Before: #911 Ubuntu `docs/frames/A13.png` — start and end date labels both sit on the right of the future Jul–Aug window (rail `min` = Wed 18 Mar). After: this PR's A13 baseline — one label, nouns in rail order, when the 2% cluster fires or the handle-label boxes overlap.

J3: `£4.68 per ticket · 553 tickets on £2,588` + `Meta says 84 purchases · Meta counts 469 fewer`.
J8: `£6.46 per ticket · 558 tickets on £3,605` + `Meta says 74 purchases · Meta counts 484 fewer`.
J7: `no usual yet — opens after your first finished NX Newcastle show`.
