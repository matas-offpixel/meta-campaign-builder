# Session log — OP909 Phase 9: Turnstile invisible-mode audit

## PR

- **Number:** 683
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/683
- **Branch:** `cursor/admin-p9-turnstile-audit`

## Summary

Docs-only audit answering "why is the Turnstile widget still visible
despite `appearance: interaction-only`". Verdict: the code is correct
and deployed (param confirmed in the live prod bundle); the sitekey's
Widget Mode at Cloudflare is Managed, which escalates to a visible
interactive challenge for low-reputation visitors (IG/TikTok in-app
webviews — our main traffic). Fix is a 1-minute Cloudflare dashboard
toggle (Widget Mode → Invisible) by Matas; no code change, no env
change, no deploy.

## Scope / files

- `docs/TURNSTILE_INVISIBLE_MODE_AUDIT.md` — NEW: implementation
  audit, live-prod DOM evidence, widget-mode comparison table, precise
  dashboard steps, trade-off (Invisible removes the interactive rescue
  path → watch for 403 `captcha failed` spikes; flip back or use
  Non-interactive if fans get rejected), post-flip verification plan.
- `docs/LANDING_PAGE_ARCHITECTURE.md` — §9 layered-defence note
  cross-linking the audit.
- `docs/ADMIN_DASHBOARD_ARCHITECTURE.md` — phase log row.

## Validation

- [x] Evidence gathered from LIVE prod (2026-07-05): sitekey
  `0x4AAAAAADvl7YKglAoGMhcl` read from the served page; deployed chunk
  greps positive for `interaction-only`; DevTools inspection of the
  live Jackies Mallorca LP showed NO iframe and a valid 858-char token
  minted silently into `cf-chl-widget-…_response` (height-0 host) — the
  invisible path works for trusted browsers, proving visible sightings
  are Managed-mode escalations.
- [x] Docs-only PR — no build/test surface changed.

## Notes / landmines

- Cloudflare exposes no API to read a sitekey's Widget Mode; the
  Managed conclusion is behavioural (silent mint on trusted browser +
  real visible-challenge sightings — only Managed produces both).
- `localhost` is not in the widget's allowed hostnames (the 110200 seen
  during Phase 4 verification) — optional dashboard addition, or keep
  the unset-keys dev bypass / Cloudflare dummy test keys.
