# Session log — OP909 Phase 5: fan data table + CSV export

## PR

- **Number:** 679
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/679
- **Branch:** `cursor/admin-p5-fans`

## Summary

The `/admin/{slug}/fans` table: decrypted email/phone, social handle,
country, WhatsApp opt-in, relative signup time, page link, soft-delete —
with query-string filters (page, country, opt-in, date range, search),
50-row pagination, and a filter-honouring CSV export. Migration 138 adds
a batch decrypt RPC so a page costs 2 decryption round trips instead of
100.

## Scope / files

- `supabase/migrations/138_landing_page_decrypt_batch.sql` — NEW
  `landing_page_decrypt_batch(bytea[], text)`: order/null-preserving
  array decrypt, SECURITY DEFINER, `search_path = public, extensions`,
  service_role only, verification round-trips through
  `landing_page_encrypt` incl. a null element and asserts anon/authed
  have no EXECUTE. **Applied to prod** with this PR.
- `lib/admin/fans-query.ts` — NEW pure module: filter parsing,
  query-string round-trip, search classification (email→hash /
  handle→ilike), serialisable query plan, RFC-4180 CSV with
  formula-injection guard, filename builder.
- `lib/db/fan-signups.ts` — NEW data layer (service-role for decrypt;
  clientId pinned first, from `requireClientContext` only). Filter
  options read on the session client (no PII).
- `lib/actions/fan-signups.ts` — NEW `softDeleteFanSignup` (sets
  `deleted_at`, client-pinned update).
- `app/admin/[clientSlug]/fans/page.tsx` — replaced ComingSoon: GET-form
  filter bar, table, pagination (all server-rendered — decrypted PII
  never crosses into client-component props).
- `app/admin/[clientSlug]/fans/export/route.ts` — NEW CSV download.
- `lib/admin/__tests__/fans-query.test.ts` — NEW suite (24 tests):
  parse/round-trip, search classification, byte-diffed query plans,
  CSV byte-diff incl. escaping + formula guard.
- `CLAUDE.md` migration ledger → 138; architecture doc Phase 5 section.

## Validation

- [x] `npx tsc --noEmit` — clean for touched files
- [x] `npm run build`
- [x] `node --test` fans-query suite 24/24
- [x] Migration 138 applied to prod; PostgREST smoke: service_role batch
  round-trip `['smoke@example.com', null]` OK, anon call → 401
- [x] Browser (3 seeded GMC rows + 2 pre-existing test rows): table
  renders decrypted PII; `?country=GB&consent=wa-opted-in` → 1 row;
  email search (hash exact) → 1 row; `@diego` handle search hits;
  CSV export returns 200 `text/csv` with
  `gmc-worldwide-productions-fans-2026-07-05.csv`, formula-guarded
  phone (`'+44…`), filter-scoped rows; Delete removes the row from the
  table (soft); cross-client `/admin/some-other-client/fans/export` →
  403. All test signups removed after.

## Notes / deviations

- Consent filter targets `consent_wa_opt_in_at` (marketing consent is
  required at signup — every row has it, so the brief's
  "opted-in/declined" filter would be a no-op).
- Phone search unsupported (encrypted at rest); the UI says so. Email
  search is exact-match via the salted hash — same normalisation as the
  write path.
- CSV export is a route handler, not a server action (downloads need
  real headers); auth contract identical.
- Country filter is single-select (brief said multi) — pragmatic
  GET-form cut, same for the missing per-signup detail view (P2 if
  time).
- Turbopack refuses a SYMLINKED node_modules ("points out of the
  filesystem root") — worktrees need a real `npm install`.
