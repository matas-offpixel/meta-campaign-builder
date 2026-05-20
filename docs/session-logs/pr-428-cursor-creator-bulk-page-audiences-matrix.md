# Session log — Bulk Page Audiences (subtype × retention matrix)

## PR

- **Number:** 428
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/428
- **Branch:** `cursor/creator/bulk-page-audiences-matrix`

## Summary

Adds a new "Bulk page audiences" builder under `/audiences/[clientId]/bulk-page`
that takes ONE FB/IG source selection and writes the full `(subtype × retention)`
matrix in a single pass. Cells reuse the existing
`createMetaCustomAudience` → `writeSplitPageEngagement` path from PR #427 so
oversized page sets (>5 sources) auto-split into sibling audiences without any
duplicated split logic. Scope is page-sourced subtypes only
(`page_engagement_fb/ig`, `page_followers_fb/ig`); video and pixel are out.

## Scope / files

- `lib/audiences/bulk-page-types.ts` — pure types, retention→funnel mapping,
  preview shape, and `pagePreviewToInserts` conversion.
- `lib/audiences/__tests__/bulk-page.test.ts` — 28 unit tests covering predicates,
  funnel mapping, preview matrix shape, naming + label override, split detection,
  and DB-insert conversion.
- `app/api/audiences/bulk-page/preview/route.ts` — POST endpoint that returns
  the preview matrix (validates subtypes/retentions/sources, builds preview
  using `buildPagePreview`).
- `app/api/audiences/bulk-page/create/route.ts` — POST endpoint that persists
  drafts via `createAudienceDrafts`, then writes each cell with
  `createMetaCustomAudience` at cell-level concurrency 2 (per-cell try/catch,
  no abort on failure).
- `app/(dashboard)/audiences/[clientId]/bulk-page/page.tsx` — server page
  shell (auth, client lookup, writes-enabled flag).
- `app/(dashboard)/audiences/[clientId]/bulk-page/bulk-page-form.tsx` — client
  3-step form: source picker (FB + IG independently, reuses existing
  `SourcePicker` for `page_engagement_fb` and `page_engagement_ig` instances) →
  subtype checkboxes → retention checkboxes + custom retentions → preview
  matrix → create.
- `app/(dashboard)/audiences/[clientId]/audience-list-actions.tsx` — adds a
  "Bulk page audiences" link next to "Bulk video stack".

## Reuse / non-reuse

- **Reused (no reimplementation):** `createMetaCustomAudience` (which delegates
  to `writeSplitPageEngagement` when `pageIds.length > MAX_PAGE_ENGAGEMENT_SOURCES`),
  the cell idempotency keys from `metaAudienceIdempotencyKey`, the FB+IG
  pickers from `components/audiences/source-picker.tsx`, and the
  `resolveAudienceSourceContext` / `createAudienceDrafts` plumbing from
  bulk-video.
- **Not changed:** PR #427's split path is untouched; the single-audience
  builder and Bulk Video builder are untouched; no new persistence (matrix
  rows fit existing `meta_custom_audiences`); no new migration.

## Resilience

- Per-cell try/catch in `writeCellsWithConcurrency` — a single failed cell
  surfaces as a failure row in the response and does not abort the matrix.
- Cell concurrency is capped at 2 (`CELL_CONCURRENCY`), keeping total Meta
  fan-out predictable against the #80004 ad-account rate limit even when
  individual cells fan out further inside the split path.
- Idempotency: every cell gets its own DB row → its own
  `metaAudienceIdempotencyKey(audienceId, userId)` base key. Splits within a
  cell get `:p{n}` suffixes (already in `audience-idempotency.ts`). Retries
  are duplicate-free.

## IG handling

IG subtypes bypass the FB-page access prefilter automatically — the prefilter
in `audience-write.ts` only matches `page_engagement_fb` via
`PAGE_ENGAGEMENT_SUBTYPES`. The matrix builder passes IG account IDs straight
to Meta unchanged. This preserves the PR #426 fix.

## Validation

- [x] `npx tsc --noEmit` — no new errors (the existing errors in
  `audience-idempotency.test.ts`, `funnel-aggregations.test.ts`, and several
  regex-`d`-flag test files are pre-existing and unrelated).
- [x] `npx tsx --test lib/audiences/__tests__/bulk-page.test.ts` — 28/28 pass.
- [x] `npx tsx --test lib/meta/__tests__/audience-write.test.ts
       lib/audiences/__tests__/bulk-video.test.ts` — 60/60 pass (PR #427 +
       bulk-video tests still green).
- [x] `npm run lint` — no new lint errors in the new files (pre-existing
  warnings in unrelated files are not from this change).

## Notes

- Funnel-stage mapping in `funnelStageForCell` mirrors `FUNNEL_STAGE_PRESETS`:
  followers always land in `top_of_funnel`; engagement `≥180d` → `top_of_funnel`,
  `60–179d` → `mid_funnel`, `<60d` → `bottom_funnel`. This keeps matrix rows
  in the same dashboard tabs as single-builder audiences.
- Naming follows the existing `buildAudienceName` shape:
  `[<labelPrefix>] <subtype-label> <retention>d`. The optional "Name prefix"
  input lets users override the default (client slug) — e.g. type
  `Innervisions` for `[Innervisions] FB page engagement 180d`. Split parts get
  the existing `(i of n)` suffix from `partAudienceName`.
- Followers cells still get one cell per requested retention so the preview
  reflects the user's intent; the existing `buildMetaCustomAudiencePayload`
  forces `retention_seconds = 0` on the actual Meta rule (already in
  `audience-payload.ts`).
