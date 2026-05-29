# Session log — Funnel Pacing budget bar + Manchester data check

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/funnel-pacing-budget-bar-and-data-check`

## Summary

Workstream A: adds a live-updating Budget Progress Bar inside the Stage
Performance card, above the 4 stage bars. The scrubber (moved back below
the bars) drives this bar live. Workstream B: diagnostic audit of the
Manchester ticket-count divergence (Performance 1,770 vs Pacing 849) —
report only, no code change.

## Scope / files

- `components/dashboard/clients/funnel-pacing-interactive.tsx` — WA (new BudgetProgressBar, reorder)

## Validation

- [x] ESLint: 0 new errors or warnings in changed file
- [ ] `npm run build` (run by CI)

## Notes

- WB: convergence fix (align Funnel Pacing to tier_channel_sales) deferred to #489
- Scrubber moved back below stage bars (reverting #487 layout) per #488 brief
