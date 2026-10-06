# Saved interest clusters

## PR

- **Number:** 1026
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1026
- **Branch:** `cursor/saved-interest-clusters`

## Summary

Operators can pick a saved interest cluster on the Audiences step instead of rebuilding it by hand. Each cluster card shows its measured evidence from the 2026-10-06 interest-performance report. The strip is filtered by the draft client's vertical. "Best CPR" sorts by `cprIndex`, which is the cluster's CPR divided by its clients' median CPR, so cheap markets don't dominate the ranking. Picking a cluster adds a normal interest group. Targeting, Generate and the Meta interest search are unchanged.

## Scope / files

- `supabase/migrations/181_interest_clusters.sql`:
  - `clients.vertical` (`music` / `football` / `other`). Backfill: `4thefans` gets `football`; every other client gets `music`.
  - `interest_clusters` table, unique `(user_id, name)`, RLS per user.
- `supabase/migrations/182_interest_clusters_seed.sql`:
  - Inserts 16 `source = 'seed'` rows for `matas@offpixel.co.uk`, with `on conflict (user_id, name) do nothing`.
  - The JSON is embedded verbatim from `docs/analysis/interest-templates-seed.json`.
- `docs/analysis/interest-clusters-seed-keys.json`: the cluster keys, names, verticals and drops.
  - Regenerate the seed with `npx tsx scripts/interest-performance.mts --seed-keys=docs/analysis/interest-clusters-seed-keys.json`.
- `lib/analysis/interest-performance.ts`: `seedFromKeys`, `clientMedianCpr`. The report JSON now carries `perClient[].medianCpr`.
- Pure helpers in `lib/interest-clusters.ts`. DB access in `lib/db/interest-clusters.ts`.
- `app/api/interest-clusters` (GET / POST / PATCH) and `app/api/interest-clusters/use` (POST).
- `components/steps/audiences/saved-interest-clusters.tsx`: the strip, "Save as cluster", and the Manage dialog. Mounted from `interest-groups-panel.tsx`.
- `InterestGroup.nameSource` (optional). Picked groups are `generated`; editing the name makes it `operator`.

## Validation

- [x] `npm test` (6689 pass, 0 fail; `lib/__tests__/interest-clusters.test.ts` 7/7)
- [x] `npm run build`
- [x] eslint on the new and changed files
- [x] Screenshot of the strip and the Manage dialog, from a throwaway `/frames` page with the API stubbed to the seed rows (not committed)

## Notes

- Migrations 181 and 182 are unapplied. Matas applies them. Until then, GET returns 503 `tableMissing` and the strip hides itself.
- Per-client median CPR is the median of the client's non-thin cluster CPRs, falling back to all clusters when none is non-thin:

  | Client | Median CPR |
  |---|---|
  | Deep House Bible | £2.64 |
  | IRONWORKS | £1.60 |
  | 4theFans | £0.84 |

  These are higher than the review's £0.45 / £0.8 figures, so DHB clusters get low indexes. "Streaming — full" (0.36) sorts first on Best CPR.
- Thin clusters (Fashion, Luxury, Music festivals) sort after every non-thin cluster on Best CPR. "Latest iPhone users" is last among the non-thin music clusters.
- The "Latest iPhone users" evidence is scoped to Off/Pixel (14 ad sets, £369). The full cluster across clients is 33 ad sets.
- Luxury drops SEAT Ibiza (6003651391313). Its evidence was measured with SEAT Ibiza included, and the Manage dialog says so.
- Techno, Tech house and House music are deliberately not seeded. The Manage dialog's empty state says why.
