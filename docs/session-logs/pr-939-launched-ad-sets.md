# Session log

## PR

- **Number:** 939
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/939
- **Branch:** `cursor/launched-ad-sets`

## Summary

Phase 0 of the self-learning join. Every Meta ad set this app creates now gets a `launched_ad_sets` row whose descriptor is a launch-time snapshot, keyed on `meta_adset_id`. Performance and the audience fact can be joined. Nothing recommends anything. The only operator-visible change is that the Armed row's event name is a link.

## Scope / files

- `supabase/migrations/175_launched_ad_sets.sql` — table, indexes `(draft_id)`, `(event_id)`, `(client_id, source_type)`. Matas applies by hand.
- `supabase/migrations/176_creative_tag_assignment_meta_ids.sql` — nullable `meta_ad_id` / `meta_creative_id`. Matas applies by hand.
- `lib/launched-ad-sets/*` — snapshot, never-throw upsert, launch recorder, backfill planner
- `app/api/meta/launch-campaign/route.ts` — six additive `recordCreatedAdSet` calls after successful creates. `cleanSuggestions` strip left in place. Attach-existing paths do not write.
- `app/api/meta/create-adsets/route.ts` — same write after `createMetaAdSets` (legacy / unused UI path; parity)
- `app/api/cron/refresh-active-creatives/route.ts` — autotagger stamps Meta ids when the group has them
- `lib/db/creative-tags.ts` — optional columns on upsert, spread only when set
- `scripts/backfill-launched-ad-sets.mjs` — dry-run default; `--apply` after Matas reads the print
- `components/optimisation/armed-campaign-row.tsx` — event name links to `/events/{id}`
- `evaluate.ts` / `apply.ts` / `gates.ts` / `components/plan/**` / `lib/reporting/creative-patterns-cross-event.ts` untouched

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5706 tests, 5702 pass, 4 skipped)
- [x] `frames:check` — no `docs/frames` file touched, zero baselines. Local Darwin rasters differ from Ubuntu (same as #921–#927). CI is the authority.

## Notes

- Migrations 175 and 176: prod first, then CI, only when the PR is about to merge.
- `ENABLE_OPTIMISATION_WRITES` unchanged and live. `pauseFloorBudget` untouched. No campaign's arm state changes.
- Bulk-attach (`POST /api/meta/bulk-attach-ads`) attaches ads onto existing ad set ids and does not create ad sets. The create paths are launch-campaign (including `attach_campaign` / MC clones) and legacy `create-adsets`.
- Backfill dry-run count is stated in the PR body once the script has been run against prod.
- Launch-route freeze allows additive bookkeeping only (zero removals, six `recordCreatedAdSet` calls).
