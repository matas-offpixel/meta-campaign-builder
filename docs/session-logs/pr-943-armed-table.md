# Session log

## PR

- **Number:** 943
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/943
- **Branch:** `cursor/armed-table`

## Summary

Armed is a table. The two questions — metric against target, daily budget against cap — are columns, not sentences. Ended (`skip_event_passed` / `skip_campaign_ended`) has its own sub-tab. The prose from #937–#942 folds under the row. Sort is client-side, Live-and-pricey on a cold load, persisted in `localStorage`. No new fetch. No verdict.

Round 2: vs target matches the loop (`useOverride`, then benchmark) and inverts `roas`/`ctr` so the column is always "how far the wrong way". vs cap reads the draft (and launched_ad_sets already on the armed load), not only applied writes. A derived campaign ceiling is `—` / *derived cap not on this view*, never the hard ceiling.

## Scope / files

- `lib/optimisation/armed-table.ts` — vs-target, vs-cap, ended partition, sort
- `lib/optimisation/armed-read-model.ts` — `accountBenchmarkValue` on controls
- `lib/optimisation/armed-impact.ts` — `adSetCount` from the write map already in hand
- `components/optimisation/armed-campaign-row.tsx` — table, Active/Ended tabs, expandable detail
- `components/library/campaign-library.tsx` — wider Armed pane
- `lib/optimisation/__tests__/armed-table.test.ts`
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` / `?count=1` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5787 tests, 5783 pass, 4 skipped)
- [ ] `npm run frames:check` — local frames server did not start (no Supabase env in this worktree). No Armed frame exists; CI is the check.

## Notes

- Absent cells are `—` plus a reason (`no target set`, `no cap`, `no tick yet`, `derived cap not on this view`). Not `0`.
- Derived campaign ceiling is not on this payload (plan/spend live on the pacing cron). Those rows are absent, not a silent hard-ceiling fallback. Typed ceiling still binds.
- Shadow vs cap uses `adSetSuggestions` / `budgetAmount`, then `launched_ad_sets.initial_daily_budget_pence` from the describe read already in `loadArmedCampaignRows`. A later write overlays that ad set.
- `skip_not_delivering` and `skip_facts_unreadable` stay on Active.
- Library Armed count stays the full fleet count.
