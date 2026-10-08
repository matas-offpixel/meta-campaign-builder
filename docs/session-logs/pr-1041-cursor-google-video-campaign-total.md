# Session log: YouTube video plans — a dated plan is a campaign total

## PR

- **Number:** 1041
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1041
- **Branch:** `cursor/google-video-campaign-total`

## Summary

Follow-up to #1038. In Editor import test 2, "Daily" imported as Editor's "Avg. daily", and Editor warned: "Your Video campaign has an end date, but is using an average daily budget". Every plan we run has an end date. So when start and end dates are set, the Editor file now writes Budget type "Campaign total": the plan total as is, or else the daily budget × inclusive days, to 2 dp. "Daily" is written only when there is no end date. Review shows "£X campaign total (≈ £Y/day over N days)". No migration.

## Scope / files

- `lib/google-video/validation.ts`: `campaignBudget` rule, `describeBudget` text.
- `components/google-video/plan-editor.tsx`: daily budget hint.
- Tests: the rule in `editor-export.test.ts`. The CamelPhat golden is now 9–24 Oct = 16 days × £8.80 = £140.80 Campaign total on V1 and the paused V2.
- `CLAUDE.md`: Google video plans budget sentence.

## Validation

- [x] `npx tsc --noEmit`: no errors in touched files
- [ ] `npm run build`: CI (the worktree's symlinked `node_modules` fails under Turbopack)
- [x] `npm test`

## Notes

- A campaign's own daily budget still wins over the plan total, and is multiplied by the days too.
- A total with an end date but no start date is written as is, with no per-day figure.
