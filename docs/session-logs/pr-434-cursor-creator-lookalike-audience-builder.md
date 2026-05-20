# Session log — Lookalike audience builder

## PR

- **Number:** 434
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/434
- **Branch:** `cursor/creator/lookalike-audience-builder`

## Summary

Adds a new audience builder for Meta LOOKALIKE audiences. Users pick one or
more existing custom audiences as seeds (DB-list of audiences this tool
created + a "Load more from Meta" live fetch for manually-uploaded ones),
choose a single tier (1% / 2% / 3%), and a target country (default GB).
Each selected seed becomes one lookalike on Meta. Lookalike is a brand-new
`audience_subtype` — structurally different from every existing subtype
(uses `origin_audience_id` + `lookalike_spec` instead of a `rule`). Migration
095 extends the `audience_subtype` CHECK constraint to include `'lookalike'`;
all lookalike-specific fields (origin id, ratio, country, seed name) live
inside the existing `source_meta` jsonb — no new columns.

## Scope / files

### Schema

- `supabase/migrations/095_meta_custom_audiences_lookalike_subtype.sql` —
  programmatically drops any existing `audience_subtype` CHECK on the table
  (by `pg_get_constraintdef ilike '%audience_subtype%'`) and recreates it
  with `'lookalike'` added. Purely additive — no data backfill needed.

### Types + enum + payload

- `lib/types/audience.ts` — extends `AudienceSubtype` with `"lookalike"` and
  adds a `lookalike` variant to `AudienceSourceMeta` carrying
  `originAudienceId`, `ratio`, `country`, `seedName`, optional
  `seedLocalAudienceId`, `seedSubtype`, `type`.
- `lib/audiences/metadata.ts` — adds the `"lookalike"` constant to
  `AUDIENCE_SUBTYPES` and a `"Lookalike"` label to `AUDIENCE_SUBTYPE_LABELS`.
- `lib/meta/audience-payload.ts` — new `lookalike` branch in
  `buildMetaCustomAudiencePayload`. Returns
  `{name, subtype:"LOOKALIKE", origin_audience_id, lookalike_spec}` with
  **no** `rule`, **no** `prefill`, **no** `retention_days`. Verified 2026-05-20
  against Meta Marketing API docs (Lookalike Audiences guide): `subtype=LOOKALIKE`
  IS required at create time (documented exception to the engagement-audience
  subtype-drop rule from PR #340). `lookalike_spec` uses `type` + `ratio` +
  `country` for a single-tier lookalike (no `starting_ratio` needed).
- `lib/audiences/naming.ts` — adds a `"lookalike"` case to
  `subtypeMiddlePhrase` to keep the exhaustive switch typed (lookalikes build
  their own names via `buildLookalikeCellName` and don't actually flow
  through this generic builder).
- `lib/audiences/api.ts` — `mergeSourceMeta` now throws when called with
  `subtype === "lookalike"` (the legacy single-audience constructor isn't on
  the lookalike code path; surfacing the contract makes the type narrowing
  honest after widening `AudienceSubtype`).

### Lookalike-specific library

- `lib/audiences/lookalike-types.ts` — pure types + constants + preview
  builder. Tier presets (1/2/3), `tierToRatio` (×0.01), country normaliser
  (default GB), seed candidate shape, preview builder with defensive dedup
  by `metaAudienceId`, naming helper (`[prefix] <seed> LAL N% CC` with
  seed-portion clipped at 60 raw chars so the LAL suffix always survives
  sanitisation), and `lookalikePreviewToInserts` returning
  `MetaCustomAudienceInsert[]` (subtype=lookalike, funnel=top_of_funnel,
  retentionDays=1 sentinel, sourceId=origin Meta id, sourceMeta packed with
  full lookalike payload data + seed provenance).

### API routes

- `app/api/audiences/lookalike/meta-seeds/route.ts` — GET. Lists ad-account
  custom audiences live from Meta via
  `GET /act_{id}/customaudiences?fields=id,name,subtype,approximate_count_*,operation_status`.
  Filters out `LOOKALIKE` subtype seeds (no lookalikes-from-lookalikes).
  Ownership-gated through `resolveAudienceSourceContext`; rate-limit-aware
  (returns 429 + `audienceSourceRateLimitBody` message on #80004 / #17 / #4).
- `app/api/audiences/lookalike/preview/route.ts` — POST. Pure preview, no
  Meta writes. Validates seeds, tier, country; resolves client slug/name;
  returns `buildLookalikePreview` output.
- `app/api/audiences/lookalike/create/route.ts` — POST. Saves drafts via
  `createAudienceDrafts`, then (when `createOnMeta=true` AND
  `metaAudienceWritesEnabled()`) writes to Meta with concurrency=2 via
  `createMetaCustomAudience` (which hits the new lookalike branch in the
  payload builder). Per-seed try/catch — a single failed cell (e.g. seed
  with <100 members) doesn't abort the batch; the response surfaces
  per-cell success/failure with the seed name and error message.

### UI

- `app/(dashboard)/audiences/[clientId]/lookalike/page.tsx` — server
  component. Fetches the DB list of ready+meta-id-present audiences (filtered
  out lookalikes), passes them to the form as initial seed pool.
- `app/(dashboard)/audiences/[clientId]/lookalike/lookalike-form.tsx` —
  client form. Seed picker with search, source-filter tabs (All / Local /
  Meta), and a "Load more from Meta" button that merges + dedupes Meta
  results into the DB-seeded pool (DB rows win on dedup — they carry richer
  metadata). Step 2 tier (single-select 1/2/3 radio per Matas's spec). Step
  3 country (select with sensible default list, defaults GB). Optional
  prefix override. Preview panel shows cell list with seed name + audience
  IDs; create panel surfaces concurrency and writes-enabled state. Done
  screen with per-cell success/failure rows + Meta IDs. Follows the
  bulk-website-form `resetPreview` pattern (no setState-in-effect).
- `app/(dashboard)/audiences/[clientId]/audience-list-actions.tsx` — adds a
  "Lookalike audiences" link between "Bulk website audiences" and "New
  audience".

### Tests

- `lib/audiences/__tests__/lookalike-types.test.ts` — **17 new tests** across
  7 suites: tier predicate, tier→ratio, country normalisation, naming
  (including pathological seed-name lengths and real-world sanitisation),
  cell count, defensive dedup by metaAudienceId (covers the "same seed
  appears in both DB and Meta lists" case), and insert conversion (subtype
  + funnel + retention sentinel + sourceMeta provenance).
- `lib/meta/__tests__/audience-write.test.ts` — **3 new tests** for the
  payload branch: emits LOOKALIKE subtype + origin_audience_id +
  lookalike_spec, no rule, no prefill, no retention_days; ratio/country
  mapped verbatim; default `type=similarity`; throws on wrong sourceMeta
  shape.

## Validation

- [x] `npm run lint` — no new errors from any lookalike-touched file
  (remaining errors are all pre-existing in `useMeta.ts`,
  `facebook-error/page.tsx`, etc.; warnings unchanged).
- [x] `npm run build` — passes after extending `subtypeMiddlePhrase` (naming)
  and adding the lookalike guard in `mergeSourceMeta` (api). Both routes
  registered:
  - `ƒ /api/audiences/lookalike/create`
  - `ƒ /api/audiences/lookalike/meta-seeds`
  - `ƒ /api/audiences/lookalike/preview`
- [x] Audience-domain tests — **91/91 pass** across
  `bulk-website.test.ts` (39), `lookalike-types.test.ts` (17, new),
  `audience-write.test.ts` (35 with 3 new lookalike payload tests).

## Pre-flight notes (reported in this PR per task brief)

- **Meta lookalike_spec**: verified `ratio` is the correct field for a
  single-tier lookalike (not `starting_ratio`/`ending_ratio` — those are
  for ranges like 1%–2%). `subtype=LOOKALIKE` IS required (documented
  exception vs engagement-audience subtype-drop). POST returns `{id}` like
  other customaudiences POSTs.
- **Schema**: `source_meta` jsonb holds `originAudienceId`, `ratio`,
  `country`, `seedName`, `seedLocalAudienceId` cleanly — no dedicated
  columns. Migration 095 is the **only** schema change and only extends
  the `audience_subtype` CHECK to permit the new value. No backfill.
- **Reuse**: `createMetaCustomAudience`, `metaAudienceIdempotencyKey`,
  `metaAudienceWritesEnabled`, `CHUNKABLE_SUBTYPES` (lookalike excluded —
  single-source by definition), `PAGE_ENGAGEMENT_SUBTYPES` (lookalike
  excluded — no page-access prefilter), `audienceSourceRateLimitBody`,
  `resolveAudienceSourceContext` all reused without modification.

## Notes / follow-ups

- Lookalike `retentionDays` is stored as `1` as a sentinel — Meta lookalikes
  auto-refresh from their seed audience and have no retention concept, but
  the existing CHECK constraint requires `> 0`. Not surfaced in the UI as a
  meaningful field.
- The seed picker filters out existing `LOOKALIKE` subtype audiences on the
  Meta side (no lookalikes-from-lookalikes from this builder); the DB list
  does the same. Users wanting that exotic case can use Meta's UI.
- Migration 095 was added — flagged in the PR description per the
  "STOP and report before applying" rule. The change is purely additive
  (extending an allow-list); zero data risk. Squash-merge after Vercel green
  per the repo's manual-merge convention.
- The lookalike payload branch deliberately constructs its return object
  from scratch rather than spreading `base` because `base` includes
  `prefill: "1"`, which has no meaning for lookalikes (they auto-refresh
  from the seed) and might trigger Meta validation issues. Kept explicit
  to avoid any chance of regression.
