# Session log

## PR

- **Number:** 746
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/746
- **Branch:** `cursor/wa-community-alias-redirect`

## Summary

WhatsApp community alias redirects for `/j/{slug}`. Templates keep a static
approved-domain button URL; operators create a slug, stage spare invite codes,
and one-click activate the next group when the current community fills —
without a new Meta template review. Raw invite codes continue to pass through
unchanged for every live template.

## Scope / files

- `supabase/migrations/150_wa_community_aliases.sql` — aliases, destinations, audit events
- `app/j/[invite]/route.ts` — slug lookup first, then passthrough
- `lib/wa-communities/*` + `lib/db/wa-community-aliases.ts` — resolve + CRUD
- `app/(dashboard)/wa-communities/` + `components/admin/wa-communities/` — ops UI
- `app/api/wa-communities/**` — create / update / activate destinations
- Ops nav link under Business Managers

## Design decision — ordered destinations

**Yes, support an ordered list of groups per alias with one marked active.**
Repointing is the whole feature; when group 1 fills, activating a pre-staged
group 2 is one click instead of pasting a fresh invite code under pressure.
Staging spare communities ahead of capacity is how WA community ops already
works — the schema matches that practice.

## Validation

- [x] `node --test lib/wa-communities/__tests__/*.test.ts`
- [x] Fail-open alias lookup (table missing / throw → raw invite still passthroughs)
- [x] Short non-hyphenated non-invite → 404
- [x] `/wa-communities` NOT in PUBLIC_PREFIXES (negative auth test)
- [x] Apply migration 150 **before** merge (live `/j/*` critical path)
- [ ] Manual post-deploy: `/j/{alias}` + `/j/DHjPw1HRvipCu6S6ZT6d5P`

## Notes

- Public route uses service-role for slug lookup (unauthenticated; no user data).
- Alias lookup is fail-open: any failure logs and falls through to passthrough
  so already-approved raw-invite template buttons keep working.
- RLS mirrors BM tool: authenticated SELECT, service-role writes after
  `requireOperator()`. Ops UI `/wa-communities` is session + allowlist, not public.
- **Migration order:** apply 150 before merge. Additive schema that new code
  reads must exist first — reverse order breaks alias lookups on live templates.
