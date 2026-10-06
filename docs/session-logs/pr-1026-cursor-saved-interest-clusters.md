# Saved interest clusters

## PR

- **Number:** 1026
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1026
- **Branch:** `cursor/saved-interest-clusters`

## Summary

Operators can pick a saved interest cluster on the Audiences step instead of rebuilding it by hand. Each cluster card shows its measured evidence from the 2026-10-06 interest-performance report. The strip shows clusters for the draft client's vertical plus `lifestyle` clusters; with no client, the vertical is `music`.

"Best CPR" sorts by `cprIndex`: the cluster's CPR divided by the spend-weighted pooled CPR of its clients. A client's pooled CPR is its total spend ÷ total registrations across all of its registration-phase ad sets with interests. Using an index means cheap markets don't dominate the ranking.

Round 2 also imports Matas's historical interest library as `source = 'library'` rows.

Picking a cluster adds a normal interest group. Targeting, Generate and the Meta interest search are unchanged.

## Scope / files

- **`supabase/migrations/181_interest_clusters.sql`**
  - Adds `clients.vertical` (`music` / `football` / `other`). Backfill: `4thefans` gets `football`; a notice is raised when no row matches. Every other client gets `music`.
  - Creates `interest_clusters`:
    - `vertical` is `music` / `football` / `lifestyle` / `other`.
    - `source` is `seed` / `library` / `operator`.
    - `unresolved` holds library names Meta search did not match.
    - Unique `(user_id, name)`, RLS per user.
  - Adds `increment_interest_cluster_use(p_id)`, a single `update … set use_count = use_count + 1` with `user_id = auth.uid()`.
- **`supabase/migrations/182_interest_clusters_seed.sql`**
  - Inserts 16 `seed` rows for `matas@offpixel.co.uk`.
  - The rows are embedded from `docs/analysis/interest-templates-seed.json`.
  - Regenerate both with `npx tsx scripts/interest-performance.mts --seed-keys=docs/analysis/interest-clusters-seed-keys.json`.
- **`supabase/migrations/183_interest_clusters_library.sql`**
  - Inserts 20 `library` rows, embedded from `docs/analysis/interest-library-seed.json`.
  - Regenerate with `npx tsx --env-file=.env.local scripts/import-interest-library.mts`. Meta search responses are cached under `scripts/out/`.
  - Unresolved and skipped names are listed in `docs/analysis/interest-library-unresolved.md`.
- **SQL generation:** `lib/analysis/cluster-seed-sql.ts` writes both seed migrations.
- **`lib/analysis/interest-performance.ts`**
  - Thin = fewer than 3 ad sets with at least £5 spend each, or under £150 in total.
  - `clientBaselineCpr` gives the pooled CPR; the report JSON stores `perClient[].spendGbp`, `.registrations` and `.baselineCpr`.
  - `clusterEvidence` is shared by the seed and the library import.
- **`lib/analysis/interest-library.ts`** is the importer's pure logic:
  - Parses the "… Updated" tabs only. A column's names are the unbroken run of cells under its header. A label cell with a list in the next cell counts as a cluster.
  - Splits cells on commas and " or ".
  - Resolves a name on an exact case-insensitive match, else when the top result contains the name as whole words.
  - Skips Frequent flyers, Employers fragments, the single-interest Techno / Tech house / House music sets, and repeats of an existing interest set.
  - Maps the iPhone column to the seeded "Latest iPhone users" cluster.
- **`lib/interest-clusters.ts`**:
  - client vs cluster verticals, and `effectiveClientVertical`
  - the lifestyle filter
  - the Manage source filter
  - `unresolvedLine`
- **`lib/db/interest-clusters.ts`:** `markInterestClusterUsed` calls the RPC.
- **API:** `app/api/interest-clusters` (GET / POST / PATCH; a POST with no client saves `music`) and `app/api/interest-clusters/use` (POST).
- **`components/steps/audiences/saved-interest-clusters.tsx`:**
  - the strip, with a thin badge that counts funded ad sets and a library badge
  - "Save as cluster"
  - the Manage dialog, with All / Seed / Library / Yours chips and "N names not found on Meta" lines
- **`InterestGroup.nameSource`** (optional). Picked groups are `generated`; editing the name makes it `operator`.

## Validation

- [x] `npm test`: 6700 tests, 0 failures. Covers `lib/__tests__/interest-clusters.test.ts`, `lib/analysis/__tests__/interest-library.test.ts` and `lib/analysis/__tests__/interest-performance.test.ts`.
- [x] `npm run build`
- [x] eslint and `tsc` clean on the new and changed files
- [x] Round 1 screenshot of the strip and the Manage dialog, from a throwaway `/frames` page with the API stubbed (not committed)

## Notes

- **Migrations 181, 182 and 183 are unapplied.** Matas applies them. Until then, GET returns 503 `tableMissing` and the strip hides itself.
- **Client baselines** (pooled pixel CPR):

  | Client | Baseline CPR |
  |---|---|
  | 4theFans | £1.03 |
  | Deep House Bible | £1.34 |
  | IRONWORKS | £1.43 |
  | Electric Brixton | £2.06 |

  The baseline is pixel. A cluster ranked on first-party CPR (Disc Genre) is therefore divided by a pixel baseline.
- **Newly thin under the £5 rule:** Streaming — full, Fashion, Luxury and Music festivals, each with 2 funded ad sets. They sort after the measured clusters.
- **Labels:** the "Labels Updated" tab holds headers only, so no Labels cluster is imported.
- **Lifestyle row:** "Luxury Hotels" resolved by whole-word contains to "small luxury hotels world". That follows the rule but may not be the intended interest.
- **"Latest iPhone users"** evidence is scoped to Off/Pixel (14 ad sets, £369).
- **Luxury** drops SEAT Ibiza (6003651391313); the Manage dialog notes it.
