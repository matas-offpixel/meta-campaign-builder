# Session log — OP909 Admin Sprint 2 PR 6: fan detail view

## PR

- **Number:** 691
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/691
- **Branch:** `cursor/admin-sprint2-fan-detail` (base: `main`)

## Summary

Adds the single-fan detail view at `/admin/{slug}/fans/{id}` — the drill-down
from the fan table (new "view" link per row). Surfaces everything stored for a
signup: contact (decrypted email/phone, social), full attribution (source +
fbclid/ttclid/gclid click ids + utm params + referrer + user agent), coarse
IP-derived location, consent history (marketing + WhatsApp, and a partner line
when the client has partner consent enabled), a signup timeline (canonical +
repeat touches), a derived Meta pixel-event panel, and a Danger Zone with
delete (soft) + anonymise (irreversible), each behind a confirm dialog.

## Scope / files

- `supabase/migrations/140_event_signup_anonymize.sql` — **new.** Adds
  `event_signups.anonymized_at` + relaxes `event_signups_contactable_check`
  (adds `OR anonymized_at is not null`) so a canonical row can have both
  contact blobs nulled during GDPR erasure. Strictly more permissive = safe.
- `lib/admin/fan-detail-view.ts` (+ test) — **new.** Pure transforms:
  `fanStatus`, `extractClickIds`, `utmParams`, `formatGeo`,
  `completeRegistrationEventId`, `buildTimeline`. 6 node:test cases.
- `lib/db/fan-detail.ts` — **new.** Service-role `getFanDetail()`: canonical
  row + decrypt (landing_page_decrypt_batch) + repeat-row timeline. Read is
  **forward-compatible** — selects `anonymized_at` but falls back cleanly if
  migration 140 hasn't been applied yet (no deploy-ordering 500).
- `lib/db/client-admin.ts` — adds `getClientConsentConfig()` (partner-consent
  flag/name for the consent panel).
- `lib/actions/fan-signups.ts` — adds `anonymizeFanSignup()` (nulls all PII +
  hashes + handles + UA + referrer + utm, stamps `anonymized_at` + `deleted_at`);
  `softDeleteFanSignup()` gains an optional same-origin `redirect_to`.
- `components/admin/fan-detail-actions.tsx` — **new** client Danger Zone with
  the Supreme confirm dialog.
- `app/admin/[clientSlug]/fans/[id]/page.tsx` — **new** detail view.
- `app/admin/[clientSlug]/fans/page.tsx` — adds the per-row "view" link.

## Data-model notes (honest scope)

- **fbc/fbp** browser cookies are NOT stored; `fbclid`/`ttclid`/`gclid` click
  ids ride along in the `utm` jsonb and are what the view shows.
- **No pixel event-log table exists** — CAPI fires inline at signup and isn't
  persisted. The pixel panel is therefore DERIVED (pixel id, CAPI configured,
  the deterministic `{id}-cr` CompleteRegistration event id) with a clear
  "Meta Events Manager is the source of truth" note. No fake delivery log.
- **Partner consent** has no per-signup column (only the client-level flag);
  the panel shows a line only when enabled, labelled "not captured per-signup".

## Validation

- [x] `npx tsc --noEmit` — clean on changed files (pre-existing errors only in
      unrelated test fixtures).
- [x] `npm run build` — passes (new dynamic route `/admin/[clientSlug]/fans/[id]`).
- [x] `node --test` — 12/12 (fan-detail-view + country-names).
- [x] `eslint` changed files — clean.
- [x] Browser verify (GMC): bogus id → 404; seeded one temp signup →
      full detail renders (decrypted email/phone, source, fbclid, utm,
      referrer, UA, "London, ENG · United Kingdom (GB)", consent timestamps,
      timeline, pixel panel with GMC's real pixel + CAPI configured); confirm
      dialog opens; delete → soft-deletes + redirects to list. Temp row
      hard-deleted afterwards (0 remaining).

## ⚠️ Post-merge step

**Migration 140 was NOT applied this session** — the Supabase MCP server was
erroring, and `.env.local` has no DDL-capable connection. Apply it post-merge:

```
supabase MCP apply_migration → supabase/migrations/140_event_signup_anonymize.sql
```

Until applied: the detail view works (forward-compatible read falls back), but
the **anonymise** action will error (it writes `anonymized_at`). Delete works
regardless. Apply 140 to enable anonymise.

## Notes

- Follows the established migration convention (idempotent, verification block,
  reversibility header, apply via MCP post-merge).
- Deferred to PR 7: dashboard-home widgets (recent signups feed, pixel health
  banner, next presale countdown).
