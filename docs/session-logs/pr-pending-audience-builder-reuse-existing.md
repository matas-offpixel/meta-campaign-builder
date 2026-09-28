# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/audience-builder-reuse-existing`

## Summary

Before `createMetaCustomAudience` posts a custom audience, it reads the ad account's existing audiences and reuses the first Meta id whose rule (or lookalike spec) matches the payload that would have been sent. A name match is not enough. A hit updates the draft row's `meta_audience_id` and `status` via `updateAudience` and returns `reused: true`. It does not POST `/customaudiences` and does not write an idempotency row. No match still creates, including the seed-recovery and split paths. The killswitch still throws before any reuse or create.

## Scope / files

- `lib/meta/reuse-existing-audience.ts` — list + structural compare, injected fetch
- `lib/meta/audience-write.ts` — one check inside `createMetaCustomAudience`, before split and POST
- `app/api/meta/custom-audiences/route.ts` — same field list on the existing picker GET
- `lib/types/audience.ts` — optional `reused` on the returned audience object (not a column)
- `app/api/audiences/[id]/write/route.ts` — already returns `{ ok: true, audience }`, so the flag rides along
- Builder result rows (video, website, page, lookalike) render the word reused when the flag is set
- `lib/meta/__tests__/reuse-existing-audience.test.ts`

The picker GET is a field extension on the existing `GET /{adAccountId}/customaudiences`. It still requests `approximate_count_lower_bound` and `approximate_count_upper_bound`. It also requests `rule` and `lookalike_spec`. Lookalike creates have no `rule` (subtype LOOKALIKE, `origin_audience_id`, `lookalike_spec`), so they cannot be compared without `lookalike_spec`. Zero new Meta writes.

## Validation

- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [ ] `npm test` (when applicable)
- [ ] CI

## Notes

No migration. `supabase/migrations/068c_meta_custom_audiences.sql` indexes `meta_audience_id` with a partial index (`WHERE meta_audience_id IS NOT NULL`). There is no unique constraint on that column, so a draft row can store an id this app did not create.

No live Meta call. The new test uses a fixture list and an injected fetch. It does not use a Meta token and it does not open a network connection.

If `OFFPIXEL_META_AUDIENCE_WRITES_ENABLED` is not `true`, create still throws `Meta audience writes are disabled` before the lookup. A failed list is treated as no match and create continues. The access token is not logged.
