# Session log — creator/scan-uses-per-client-token

## PR

- **Number:** 314
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/314
- **Branch:** `creator/scan-uses-per-client-token`

## Summary

The enhancement-flags scanner no longer uses a single `META_ACCESS_TOKEN` for every client. Each client uses `resolveServerMetaToken(serviceRoleClient, client.user_id)` (OAuth row then env fallback). Missing owner user id or unresolvable token records `errors_per_client[name] = "no_meta_token"` and skips that client without failing the run.

## Scope / files

- `app/api/internal/scan-enhancement-flags/route.ts`

## Validation

- [x] `npm run build`
- [x] `npx eslint app/api/internal/scan-enhancement-flags/route.ts`
- [ ] Logged-in GET: clients with DB/env token scan; others `no_meta_token` in `errors_per_client`

## Notes

No schema change. Per-client try/catch for Graph/DB errors unchanged; token miss is a pre-check `continue`.
