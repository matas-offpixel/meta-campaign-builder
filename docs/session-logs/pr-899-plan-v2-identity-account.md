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
- [x] Review round 1: `persist-handoff` + `launch-face` + `plan-ui` (49 pass)

## Notes

Open as a draft titled `[needs migration apply]`. Do not apply 169 in this run. Merge after Matas applies, before PR B (170).

## Review round 1 — fixed

| finding | file:line | test that pins it |
|---|---|---|
| Migration 169 read `campaign_drafts.settings` — that column does not exist; settings live at `draft_json->'settings'` | `supabase/migrations/169_campaign_plan_platform_ad_account.sql` Meta backfill | `migration 169 stores the launched account on the ledger` matches `draft_json->'settings'->>'adAccountId'` |
| After launch the identity fallback was the resolver, so every pre-169 live plan still printed ELECTRIC STUDIOS SHEFFIELD | `lib/plan/launch-face.ts` `planIdentityMetaId`; `lib/plan/load.ts` `loadDraftAdAccountId` | `launched with a null ledger falls back to the linked draft, never the resolver (D.O.D)` — `act_606252931141334`, not `act_1073273492854557`; `load attaches the linked draft adAccountId when the ledger is still null (D.O.D)` |
| Google stored `google_search_plans.google_ads_account_id` (uuid FK) on the ledger; Ads Manager then fed uuid digits to `__e=` | `lib/plan/orchestrator.ts` `platformAccountFromDraft`; 169 Google backfill joins `google_ads_accounts`; `ads-manager-links.ts` `googleCustomerIdForLedger` | `google ledger stores the customer id, never the google_ads_accounts uuid`; `Google deep link is built from a customer id, never a uuid FK` |
| `loadPlanLaunchRecords` queried `campaign_drafts` for identity, so a failed draft read emptied the ledger and a live plan became deletable | `lib/plan/load.ts` ledger-only; `page.tsx` `loadDraftAdAccountId` in try/catch | `delete policy refuses on a live plan even when campaign_drafts throws`; D.O.D null-ledger identity test unchanged |
