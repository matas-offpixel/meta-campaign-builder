## PR

- **Number:** pending
- **URL:** (fill after `gh pr create`)
- **Branch:** `creator/audience-bulk-creator-events`

## Summary

Adds a "Bulk video stack" surface to the Audience Builder. Given an event-code prefix (e.g. `WC26`) the tool scans the client's events, matches Meta campaigns by `[EVENT_CODE]` bracket, fetches page-published videos, and proposes Top + Mid + Bottom funnel video views audiences for every matched event. A four-step wizard (prefix → stages → preview table → confirm/create) drives the flow, with per-audience success/failure reporting on the results screen.

## Scope / files

- `lib/audiences/event-code-prefix-scanner.ts` — pure prefix extraction from event_code list
- `lib/audiences/bulk-types.ts` — pure types, `BULK_FUNNEL_CONFIG`, `previewRowsToInserts` (no server deps, safe to import in tests and client components)
- `lib/audiences/bulk-video.ts` — server-side async logic (event→campaign→video→preview); re-exports from bulk-types.ts
- `app/api/audiences/bulk/preview/route.ts` — POST preview + GET prefix-options helper
- `app/api/audiences/bulk/create/route.ts` — POST create (draft save + optional Meta write)
- `app/(dashboard)/audiences/[clientId]/bulk/page.tsx` — server page (loads client + prefix options)
- `app/(dashboard)/audiences/[clientId]/bulk/bulk-form.tsx` — multi-step client form
- `app/(dashboard)/audiences/[clientId]/audience-list-actions.tsx` — adds "Bulk video stack" button
- `lib/audiences/__tests__/bulk-video.test.ts` — prefix scanner, campaign matcher, video dedup, naming, insert conversion

## Validation

- [x] `npm test` (754 pass, 0 fail)
- [x] `npm run build`
- [x] Scoped ESLint (0 errors, 0 warnings)

## Notes

`previewRowsToInserts` lives in `bulk-types.ts` (not `bulk-video.ts`) to keep the import chain test-safe; Node strip-only mode rejects `MetaApiError`'s parameter properties, so tests cannot import anything that transitively reaches `lib/meta/client.ts`.
