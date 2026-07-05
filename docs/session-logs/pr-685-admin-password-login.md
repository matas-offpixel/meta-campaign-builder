# Session log — password auth on admin + operator login

## PR

- **Number:** 685
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/685
- **Branch:** `cursor/admin-password-login`

## Summary

Password sign-in is now the primary login method on `/admin/login` and
`/login`, with magic link as a secondary fallback toggled via "Forgot
password? Email me a sign-in link". Fixes Matas bouncing off admin
login when magic-link callbacks fail to establish sessions on mobile.

## Scope / files

- `lib/auth/login-form.ts` — pure seams: mode toggle, password error
  mapping, testable `signInWithPasswordBoundary`
- `lib/auth/__tests__/login-form.test.ts` — 10 tests (happy path, wrong
  password, mode toggle, magic-link error copy)
- `app/admin/login/page.tsx` — email+password primary, magic-link
  fallback, preserved `?error=no-client` / `?error=auth` banners
- `app/login/page.tsx` — same pattern; removed inline reset-email +
  always-visible magic-link button; `?reset=ok` banner kept

## Validation

- [x] `node --test lib/auth/__tests__/login-form.test.ts` — 10/10 pass
- [x] `npm run build` — clean
- [x] eslint on touched files — clean

## Notes

Password reset via Supabase recovery email is unchanged:
`/auth/callback?token_hash=…&type=recovery&next=/reset-password` still
hits `verifyOtp()` in `app/auth/callback/route.ts` → `/reset-password`.
No new page needed.
