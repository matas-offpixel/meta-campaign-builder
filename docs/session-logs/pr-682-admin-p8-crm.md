# Session log — OP909 Phase 8: Bird + Mailchimp integrations UI

## PR

- **Number:** 682
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/682
- **Branch:** `cursor/admin-p8-crm`

## Summary

`/admin/{slug}/integrations/bird` + `/integrations/mailchimp`:
self-service credential entry over the existing `d2c_connections` table
and `set_d2c_credentials` / `get_d2c_credentials` RPCs — no new schema.
Each page has a status panel (configured / last tested / live-sending /
approval, all read-only for the gates), a credential form with a
write-only API key, and a read-only "Test connection" button (Bird:
list channels; Mailchimp: ping). The integrations hub now links all
three cards with live status badges.

## Scope / files

- `lib/admin/crm-schema.ts` — NEW pure module: Bird form validation
  (workspace/channel/template UUIDs, "latest" version literal,
  truncation guard, keep/replace key tri-state), Mailchimp validation
  (`<key>-dc` shape, server prefix derived from suffix, audience id),
  credential-blob builders (merge kept key from existing blob),
  `toPublicConfig` (key → boolean).
- `lib/db/crm-connections.ts` — NEW service-role access to
  `d2c_connections` scoped by client_id (RLS on that table keys on the
  OPERATOR's user_id, so client sessions can't read it directly).
  Existing rows keep their user_id; new rows owned by the client user.
- `lib/actions/crm-connections.ts` — NEW save/test actions ×2
  providers, all behind `requireClientContext()`. Test = provider
  `validateCredentials` (real read-only HTTP), outcome recorded on the
  row.
- `components/admin/crm-connection-forms.tsx`,
  `components/admin/crm-status-panel.tsx` — NEW.
- `app/admin/[clientSlug]/integrations/{bird,mailchimp}/page.tsx` — NEW.
- `app/admin/[clientSlug]/integrations/page.tsx` — hub cards for all
  three integrations.
- `lib/admin/__tests__/crm-schema.test.ts` — NEW (11 tests) including
  byte-shape pins on both credential blobs (the exact keys
  `lib/d2c/{bird,mailchimp}/provider.ts` read at send time).

## Validation

- [x] `npx tsc --noEmit` (new files clean), `npm run build`, eslint —
  clean; `node --test` 11/11
- [x] Browser (GMC, local dev against prod DB): hub showed Bird +
  Mailchimp "connected" from the real encrypted rows; Bird page
  prefilled the real workspace/channel UUIDs with the key masked;
  "Test connection" did REAL read-only API calls with the decrypted
  production keys — Bird "Connected (account 9c308f77…)", Mailchimp
  "Connected (account us7)" — and stamped last_synced_at. A keep-key
  re-save on Bird re-encrypted the blob; decrypted content verified
  byte-identical to the pre-test backup. Invalid Mailchimp key paste
  surfaced the inline datacenter-suffix error without touching the DB.
- [x] Both GMC connection blobs backed up (hex) before testing and
  verified content-unchanged after (`blob_content_unchanged: true` ×2);
  status/live_enabled/approved_by_matas untouched.

## Notes / landmines

- The spec suggested a test-fire message send behind the dry-run gate; I
  shipped a read-only `validateCredentials` round trip instead — a dry
  run proves nothing beyond the gate, while the read-only call proves
  decrypt → auth → API for real with zero send risk. Send-path payload
  byte-shapes stay pinned by the existing bird/mailchimp provider tests.
- Local `D2C_TOKEN_KEY` matches prod (unlike `LANDING_PAGES_TOKEN_KEY`),
  which is what made full end-to-end verification possible locally.
- `last_synced_at` on GMC's two rows now carries the (truthful)
  test-connection timestamp from verification.
- Known hydration-warning artifact from the browser-automation tool's
  injected attributes appeared during testing (admin-shell.tsx) — same
  false positive documented in Phases 1/3.
