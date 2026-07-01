# Session log — D2C direct-fire live-fix (layers 6–9 groundwork)

## PR

- **Number:** 661
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/661
- **Branch:** `d2c/direct-fire-live-fix`

## Summary

Fix-forward groundwork for the 2026-07-01 direct-fire incident. Layers 1–5 were
resolved via ops (pgcrypto + credentials + `D2C_TOKEN_KEY`). This PR delivers
the capture-independent code fixes and gates the capture-dependent ones:

- **Layer 7 (fixed):** `hydrateSendVariables` resolves the 6 required Bird
  template variables and loud-fails before any HTTP call if any is empty.
- **Layer 8 (fixed):** per-client fallback artwork (migration 133) added to the
  `resolveEventArtwork` chain, plus write-back to `d2c_event_copy.artwork_url`.
- **Layers 6 & 9 (gated):** live WhatsApp send now loud-fails behind
  `BIRD_RUNTIME_SEND_VERIFIED = false` instead of emitting the 422 shape. To be
  reconciled against `.scratch/bird-runtime-send-capture.txt` (NOT yet on main).
- **Runbook:** `docs/D2C_LIVE_FIRE_RUNBOOK.md` documents all 9 layers + why the
  dry-run suite missed 6–9.

## Scope / files

- `supabase/migrations/133_client_d2c_fallback_artwork.sql` (new)
- `lib/d2c/bird/hydrate-variables.ts` (new — layer 7)
- `lib/d2c/assets/resolver.ts` (layer 8 — fallback step + write-back)
- `lib/d2c/bird/provider.ts` (layers 6 & 9 gate)
- `lib/d2c/orchestration/bird-runner.ts` (wiring-pointer docs, stays loud-fail)
- `lib/d2c/bird/__tests__/hydrate-variables.test.ts` (new)
- `lib/d2c/bird/__tests__/provider.integration.test.ts` (new — active gate test + skipped shape tests)
- `lib/d2c/bird/__tests__/provider.test.ts` (updated: obsolete broken-shape test → gated behaviour)
- `docs/D2C_LIVE_FIRE_RUNBOOK.md` (new)

## Validation

- [x] `npx tsc --noEmit` — clean on changed files
- [x] `npm run build` — clean
- [x] `npm test` (d2c suite) — 91 pass, 0 fail, 4 skipped (3 pending-capture + 1 pre-existing)
- [x] `eslint` changed files — 0 errors (1 pre-existing warning)

## Notes

- **BLOCKED:** layers 6 & 9 require `.scratch/bird-runtime-send-capture.txt` on
  main (not present). Do NOT flip `BIRD_RUNTIME_SEND_VERIFIED` or un-skip the
  `provider.integration.test.ts` shape tests against guessed shapes.
- **Constraint honoured:** the cron route was intentionally NOT touched; layers
  7/8 helpers are standalone + tested, wired in with the layer 6/9 send impl.
- **Judgment calls:** (1) gated the live WhatsApp path to loud-fail rather than
  leave the known-422 shape live; (2) reused/extended `resolveEventArtwork`
  rather than adding a new `resolveEventArtworkUrl`; (3) migrations 131/132 left
  as uncommitted ops artifacts per the incident brief.
