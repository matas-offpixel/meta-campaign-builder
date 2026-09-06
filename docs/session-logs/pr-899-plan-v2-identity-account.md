# Session log

## PR

- **Number:** 899
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/899
- **Branch:** `cursor/plan-v2-identity-account`

## Summary

G30: identity prints the account the campaign actually runs on. After launch that is the linked draft's `settings.adAccountId` stored on the ledger (`platform_ad_account_id`), never the client-default resolver. Drafts prefer `events.meta_ad_account_id`; the ⓘ names the other (`client default act_…`).

## Scope / files

- `supabase/migrations/169_campaign_plan_platform_ad_account.sql` — column + backfill; Matas applies
- `lib/plan/{types,load,persist,orchestrator,record-wizard-launch,launch-face}.ts`
- `lib/clients/channel-defaults.ts` — event Meta account as override
- `components/plan/{canvas-header,plan-workspace}.tsx`
- `app/api/meta/launch-campaign/route.ts` — wizard live upsert writes the account
- `lib/plan/ads-manager-links.ts` — Ads Manager uses the ledger account after launch

## Validation

- [x] `npx tsc --noEmit` (via `npm run build`)
- [x] `npm run build`
- [x] `npm test` (5294 pass, 4 skipped)

## Notes

Open as a draft titled `[needs migration apply]`. Do not apply 169 in this run. Merge after Matas applies, before PR B (170).
