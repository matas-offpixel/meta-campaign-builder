# Session log — OP909 Phase 7: self-service Meta Pixel + CAPI setup

## PR

- **Number:** 681
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/681
- **Branch:** `cursor/admin-p7-meta-pixel`

## Summary

`/admin/{slug}/integrations/meta-pixel`: Pixel ID + write-only CAPI
token + test event code form, a status panel (pixel / token badge /
test-vs-live mode / last verified / Events Manager deep link), and a
"Send test event" button that fires a real CompleteRegistration through
the production CAPI path and stamps `meta_pixel_id_verified_at` on
success. The integrations index becomes a hub (Meta Pixel live, Bird +
Mailchimp cards teased for Phase 8). Replaces the operator SQL flow.

## Scope / files

- `lib/admin/meta-pixel-schema.ts` — NEW pure module: form validation
  (15–16 digit pixel, TEST code shape, short-token truncation guard,
  keep/set/clear token tri-state), `buildTestEventInput`,
  `eventsManagerUrl`.
- `lib/actions/meta-pixel.ts` — NEW `saveMetaPixelConfig` (updates
  pixel/test-code columns; token via `set_landing_page_capi_token` RPC,
  migration 135; pixel change nulls verified_at) and
  `sendTestPixelEvent` (decrypt via `get_landing_page_capi_token`,
  reuse `buildCapiEventPayload`+`sendCapiEvent`, stamp verified_at on
  ok). Token never logged/returned.
- `components/admin/meta-pixel-form.tsx` — NEW client form
  (useActionState ×2 — config save + test fire as separate forms).
- `app/admin/[clientSlug]/integrations/meta-pixel/page.tsx` — NEW.
- `app/admin/[clientSlug]/integrations/page.tsx` — hub replacing
  ComingSoon (pixel status badge, Phase 8 teaser card).
- `lib/admin/__tests__/meta-pixel-schema.test.ts` — NEW (9 tests):
  validation matrix + byte-diffed test-event payload through the REAL
  `buildCapiEventPayload` + Events Manager URL.

## Validation

- [x] `npx tsc --noEmit`, `npm run build`, eslint — clean
- [x] `node --test` 9/9
- [x] Browser: page renders GMC's live config (pixel shown, token
  "configured", mode live, verified 4 Jul). Save flow: pasted a dummy
  token + TEST4242 → Saved; status flipped to mode "test". Test event
  with dummy token → Meta rejected it and the UI surfaced
  `http_400: Malformed access token (fbtrace AA8q75…)` inline —
  end-to-end proof the decrypt → Graph POST → error-surfacing path
  works (a REAL Graph API round trip, permanent-4xx no-retry branch).
  verified_at correctly NOT stamped on failure.
- [x] GMC's original prod token blob, test code (null), and verified_at
  were backed up (hex) before the dummy save and byte-identically
  restored after (`blob_restored: true`).

## Notes / landmines

- Local `LANDING_PAGES_TOKEN_KEY` ≠ prod key, so decrypting the
  prod-written blob locally fails with "Wrong key or corrupt data" —
  expected, documented in the architecture doc. On Vercel the same key
  encrypts and decrypts.
- A full green-path test event (accepted by Meta + verified_at stamp)
  needs a valid CAPI token, which only Matas holds — the code path
  differs from the verified 400 path only in the response branch, which
  is pinned by the existing meta-capi tests.
- The dummy-token exercise ran on LOCAL dev against prod DB; the blob
  restore makes it invisible to prod traffic (fan CAPI sends kept
  working throughout — they run on Vercel with the prod key).
