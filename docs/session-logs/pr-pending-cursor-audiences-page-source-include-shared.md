# Session log template

## PR

- **Number:** pending
- **URL:** (pending)
- **Branch:** `cursor/audiences/page-source-include-shared`

## Summary

Fixes the FB page engagement audience source picker (Build Funnel Stack + main
wizard) reporting "No sources found" for pages the operator can actually run
ads on but that Meta's live `/me/accounts` + `owned_pages` + `client_pages`
query omits — client-shared pages (`bm_pages.is_owned_by_bm = false`, e.g.
Mungo's Hi Fi in Columbo Group's BM) and pages with only Partial access.
`GET /api/audiences/sources/pages` now unions the existing live Meta query
with two backfill sources: `bm_pages` rows where `user_has_access = true`
(read via the service-role client, tagged `source: "bm-shared"` for a future
UI indicator) and the client's curated `clients.default_page_ids` allow-list
(resolved via Meta's batched `/?ids=...` lookup, falling back to id-only
entries on failure). Note: the branch was requested as `cc/...`
(Claude-Code-owned per `CLAUDE.md`) but this session is Cursor, so it was
renamed to `cursor/...` per the repo's tool-ownership convention before any
edits were made.

## Scope / files

- `lib/audiences/page-source-union.ts` — new pure dedup/merge helper (no Meta
  SDK or Supabase imports), unit tested directly.
- `lib/audiences/sources.ts` — `resolveAudienceSourceContext` now also
  returns `metaBusinessId` / `defaultPageIds`; added `fetchPagesByIds` batched
  Meta lookup; `AudiencePageSource` gained an optional `source?: "bm-shared"`
  flag.
- `lib/db/business-managers.ts` — added `getBMPagesWithUserAccess` (bm_pages
  read scoped to `user_has_access = true`).
- `app/api/audiences/sources/pages/route.ts` — orchestrates the union inside
  the existing 30-minute in-memory cache; both backfill sources are
  best-effort and never fail the whole request.
- `lib/audiences/__tests__/page-source-union.test.ts` — new tests, including
  a Mungo's Hi Fi fixture (from `bm_pages`) that must appear even when the
  Meta live query returns 0 pages.

## Validation

- [x] `npx tsc --noEmit` — no new errors (pre-existing failures on `main` are
  in unrelated test fixtures; confirmed none reference touched files)
- [x] `npm run build` — exit 0
- [x] `npm test` — new suite passes (7/7); pre-existing unrelated failures
  confirmed present on `main` before this change (stashed and re-ran to
  verify)
- [ ] Manual smoke test (Matas / Columbo Group / "mung" search) — not run in
  this session; needs a human with Meta session access

## Notes

No UI changes were made per the task's scope — `components/audiences/source-picker.tsx`
already renders whatever the endpoint returns; the `source: "bm-shared"` flag
is available for a future subtle-indicator UI pass but unused for now.
