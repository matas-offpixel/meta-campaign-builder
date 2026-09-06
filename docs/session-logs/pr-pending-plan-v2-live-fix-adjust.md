# Session log

## PR

- **Number:** pending
- **URL:**
- **Branch:** `cursor/plan-v2-live-fix-adjust`

## Summary

Live-walk fix for the ADJUST face (D.O.D / frame J2). The reading unit follows the phase, never the stored `target_unit`; a campaign-scope suggestion names the campaign and reads the decision row; ⓘ cards split pace / benchmark / suggestion; the rail joins `now · gen sale passed …`; MetricChip formats the usual in pounds; funnel / channels / assets use the canon words.

## Scope / files

- `lib/plan/adjust-face.ts` — phase unit, suggestion from `metric_value`, campaign name, tickets-not-entered, not-connected channels
- `lib/optimisation/automation-ui.ts` + `lib/db/campaign-automation.ts` — campaign-scope rows take `settings.campaignName`
- `components/plan/{canvas-adjust,plan-workspace,canvas-channels}.tsx` — split ⓘ, signup benchmark, running fact, connected flags
- `components/viz/{metric-chip,threshold-band,window-bar,channel-row,asset-strip}.tsx` — £ usual, 4px band, collision at now, no status dots, zone F words
- `lib/viz/window-bar.ts` + `lib/plan/canvas-inputs.ts` — `now · gen sale passed Fri 4 Sep`

## Validation

- [x] `node --test` on adjust-face, window-bar-labels, automation-ui, canvas, viz-kit-redesign
- [ ] `npx tsc --noEmit`
- [ ] `npm test` (when applicable)
- [ ] Screenshots: D.O.D plan, Chrome 1176

## Notes

Merge order 1 → 2. Do not merge this PR. Production walk was `main` `895224b`. D.O.D fixture: `target_unit` click, gen sale 4 Sep, usual £1.32 from 5 NX Newcastle shows.
