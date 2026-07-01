# Session log — landing-page/scaffold

## PR

- **Number:** 660
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/660
- **Branch:** `landing-page/scaffold`

## Summary

PR 1 of the landing-page arc (replacing Evntr.ee with internal client-branded
pages; trial client GMC Worldwide Productions). Schema + public route
skeleton only: migration 132 (`client_landing_pages`, `page_events`,
`page_templates` + mvp_v1 seed + in-migration verification block), public
`/l/[clientSlug]/[eventSlug]` route with per-event provider toggle
(internal render / Evntr.ee redirect / loud-fail), service-role slug-chain
lookup, per-IP rate limit, GMC seed script, and
`docs/LANDING_PAGE_ARCHITECTURE.md` as the contract for PRs 2–8.

## Scope / files

- `supabase/migrations/132_landing_pages_scaffold.sql` (+ MIGRATIONS_NOTES
  entry for the prod-only 131)
- `app/l/[clientSlug]/[eventSlug]/page.tsx`
- `lib/landing-pages/` — types, context (pure resolution chain), resolve
  (outcome decision), rate-limit, tests (incl. the multi-tenant pixel
  isolation test)
- `lib/db/landing-pages.ts` — service-role entrypoint
- `lib/auth/public-routes.ts` — `"/l/"` added to PUBLIC_PREFIXES
- `scripts/seed-gmc-landing-page.mjs`
- `docs/LANDING_PAGE_ARCHITECTURE.md`

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test` (includes isolation + public-prefix + outcome + rate-limit
  + context-chain suites)
- [ ] Matas: apply migration 132 via Supabase MCP, run seed script, verify
  `/l/gmc-worldwide-productions/…` renders + evntree flip redirects
  (runbook in docs/LANDING_PAGE_ARCHITECTURE.md §7) — BEFORE merge

## Notes

- 🔴 Found live prod bug (out of scope here, needs follow-up):
  `set/get_d2c_credentials` still call unqualified `pgp_sym_encrypt` under
  `search_path=public` while pgcrypto lives in `extensions` — verified via
  probe that they will throw `undefined_function` when invoked. Migration
  131 enabled the extension but did not repoint the functions.
- Deviations from spec, flagged in the design doc: `page_templates` got RLS
  (anon-write hole otherwise); template binding rides in
  `page_events.content.template_key` until PR 2 promotes it to a column;
  Next page redirects are 307 not 302 (equivalent temporary semantics).
