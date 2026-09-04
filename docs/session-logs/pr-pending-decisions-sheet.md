# Session log — decisions sheet

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/decisions-sheet`

## Summary

PR 6 of 7 of the campaign creator redesign. A read-only decisions sheet
reuses the Drawer shell (platform-less: `◐ decisions · last 7d`, one
`⌁ preset` handle, `✕`). Opens from the canvas `◐ n ▸` handle with
`?drawer=decisions`. The same sheet mounts on `/campaign/[id]` in place
of the list inside the optimisation step. Zero changes to evaluate.ts,
tick-runner.ts, gates.ts, apply.ts. No new migration. Slack unchanged.

## Scope / files

**New**

- `lib/plan/decisions-sheet.ts` — why / glyph / chip / grouping / empty
  StatusLine / preset drift. Pure.
- `lib/plan/__tests__/decisions-sheet.test.ts`
- `components/plan/decisions-sheet.tsx` — sheet + rows + preset read.

**Changed**

- `components/viz/drawer.tsx` — platform-less variant.
- `lib/plan/drawer.ts` — `?drawer=decisions`.
- `components/plan/plan-workspace.tsx` / `canvas-header.tsx` — handle
  opens the sheet and marks last-opened.
- `components/optimisation/automation-arm-control.tsx` — env paragraph
  and card descriptions → InfoTip; cards are one word + StatusDot.
- `components/steps/optimisation-strategy.tsx` — mounts the sheet.
- `lib/viz/tokens.ts` — `insufficient_conversions` glyph `·`.
- `lib/db/campaign-automation.ts` — selects `metric_window`; reads
  materialised preset for drift.

## Validation

- [x] `npm run build` — clean
- [x] `npm test` — 5056 pass, 3 skipped, 0 fail

## Notes

DecisionRowView fields that were not there, and what we did instead:

- cooldown until → parse `reasonText` + `decidedAt` (`skip_recent_touch`
  is what evaluate writes; spec's `skipped_cooldown` is mapped)
- provenance → `plat` for readings, `┄` for honest empties
- delta percent → budget before/after, else `%` in `reasonText`
- rule thresholds for the band marker → `bandFromAction` as today
