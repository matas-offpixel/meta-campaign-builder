## PR

- **Number:** 140
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/140
- **Branch:** `creator/tiktok-oauth-and-insights`

## Summary

Wires TikTok Business API OAuth into the existing `tiktok_accounts` table, stores OAuth credentials through a new pgcrypto RPC pair, and replaces the event-campaign TikTok reporting stub with a live Business API insights adapter that mirrors the reporting-layer Meta event_code matcher.

## Scope / files

- `supabase/migrations/054_encrypt_tiktok_credentials.sql` adds encrypted TikTok credential storage and `set_tiktok_credentials` / `get_tiktok_credentials`.
- `app/api/tiktok/oauth/start/route.ts` and `app/api/tiktok/oauth/callback/route.ts` add the TikTok Business OAuth flow.
- `lib/tiktok/client.ts`, `lib/tiktok/credentials.ts`, `lib/tiktok/oauth.ts`, `lib/tiktok/matching.ts`, and `lib/tiktok/insights.ts` add the direct Business API client, retry classifier, OAuth parsing, credential RPC helpers, event-code matcher, and integrated report normalizer.
- `app/api/reporting/event-campaigns/tiktok/route.ts` now resolves the event's TikTok account, decrypts credentials, and returns live campaign insights.
- `components/dashboard/events/linked-campaigns-performance.tsx` enables the TikTok platform tab against the new route while leaving Google Ads disabled.
- `.env.local.example`, `lib/db/database.types.ts`, and `lib/types/tiktok.ts` document / type the new credential fields and env vars.
- `lib/tiktok/__tests__/*` covers campaign-name matching, retry classification, and the OAuth/credential helper round-trip.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`
- [x] `npm run lint` — full repo still reports existing unrelated baseline issues; touched files pass `npx eslint` with no errors or warnings.

## Notes

- TikTok campaign matching follows the reporting-layer Meta convention: bare `event_code`, case-insensitive substring. It intentionally does not use the deeper rollup-layer bracketed/case-sensitive matcher.
- New OAuth writes leave the legacy `tiktok_accounts.access_token_encrypted` column null; cleanup remains a follow-up once migration 054 is verified in production.
- `TIKTOK_CHUNK_CONCURRENCY` is intentionally load-bearing and set to `1` until production rate-limit behaviour proves a higher value safe.
