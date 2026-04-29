## PR

- **Number:** 182
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/182
- **Branch:** `creator/google-ads-oauth-and-insights`

## Summary

Wire Google Ads OAuth, encrypted credential storage, and live campaign insights so Google can participate in the event reporting flow using the same event_code matcher as Meta/TikTok.

## Scope / files

- Google Ads credential migration `060_encrypt_google_ads_credentials.sql` with pgcrypto RPCs, Vault/current_setting key fallback, login customer storage, and client FK idempotency.
- Google Ads OAuth start/callback routes, signed CSRF state, token exchange, account upsert, and encrypted credential writes.
- Google Ads API client + insights adapter with a platform-specific serial concurrency constant and retry classifier.
- `/api/google-ads/insights` now resolves the plan/event/account, decrypts credentials, and calls the live adapter.
- `lib/reporting/event-insights.ts` now accepts `platform: 'meta' | 'google' | 'tiktok'` while keeping existing Meta/TikTok call paths compatible.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Migrations / infra state: Local applied y, Prod applied n. Ops should apply via Supabase MCP after merge.
- Follow-up cleanup PR: drop the unused legacy `google_ads_accounts.access_token_encrypted` placeholder after production verification.

### Shared-file edits surfaced for ops batch

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REDIRECT_URI`
- `GOOGLE_ADS_TOKEN_KEY` (>=32 chars; never rotate without re-OAuth on every linked account, same caveat as `TIKTOK_TOKEN_KEY` and `EVENTBRITE_TOKEN_KEY`)
