# Session log — multi-IG per page picker

## PR

- **Number:** 600
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/600
- **Branch:** `cc/multi-ig-per-page-picker`

## Summary

When a Facebook Page has multiple linked Instagram accounts (e.g. LWE with 6 IGs), the wizard and launch route previously assumed one IG per page and Meta silently attached the wrong handle (`@ionfestival` instead of `@l_w_e`). This PR returns all linked IGs from Graph, surfaces a required picker in Audiences/Creatives, stores `settings.pageInstagramOverrides`, and gives operator overrides highest priority in launch Phase 1.5 with a hard preflight when multi-IG pages lack a pick.

## Scope / files

- `lib/types.ts` — `PageIgOption`, `PageIgResponse`, `pageInstagramOverrides`, `multiIgPageIds`
- `lib/meta/client.ts` — `fetchPageInstagramOptions`, multi-IG flatten in `fetchInstagramAccounts`
- `app/api/meta/instagram-accounts/route.ts` — `{ pages, data }` response shape
- `app/api/meta/launch-campaign/route.ts` — Phase 1.5 override priority + preflight
- `components/wizard/page-instagram-overrides-panel.tsx` — shared picker UI
- `components/steps/creatives.tsx`, `audiences-step.tsx`, `wizard-shell.tsx`
- `lib/validation.ts`, `lib/validation/page-instagram.ts`

## Validation

- [x] `npm run build`
- [ ] Vercel Preview: LWE page shows 6-IG picker; launch log `source: operator-override`

## Notes

- Per-client persistence (`client_page_instagram_defaults`) deferred to PR #602.
- Meta MCP was unavailable during audit; LWE verification pending on Preview/prod.
