# Session log

## PR

- **Number:** 771
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/771
- **Branch:** `cursor/facebook-oauth-scopes-env`

## Summary

Make the Facebook OAuth scope list env-overridable via `FACEBOOK_OAUTH_SCOPES` so the v2 Meta app (Off Pixel Ads Manager) can omit `instagram_basic`, which newly-created Meta apps can no longer request. Main deployment keeps the default list when the env var is unset.

## Scope / files

- `app/api/auth/facebook-start/route.ts` — `FB_SCOPES` from `FACEBOOK_OAUTH_SCOPES` or default
- `lib/settings/connection-status.ts` — settings missing-permissions check from same env var
- `CLAUDE.md` — document `FACEBOOK_OAUTH_SCOPES`
- Intentionally untouched: `lib/facebook-connect.ts` (client-side legacy GoTrue scopes)

## Validation

- [ ] `npx tsc --noEmit`
- [ ] Confirm unset env → same scopes as before (includes `instagram_basic`)
- [ ] Confirm set env without `instagram_basic` → dialog + settings UI align

## Notes

Set `FACEBOOK_OAUTH_SCOPES` on the v2 Vercel deployment only, e.g.
`pages_show_list,pages_read_engagement,ads_management,ads_read,business_management`.
