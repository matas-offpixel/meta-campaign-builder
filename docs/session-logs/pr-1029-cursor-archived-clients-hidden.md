# Archived clients hidden from dashboard defaults and crons

## PR

- **Number:** 1029
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1029
- **Branch:** `cursor/archived-clients-hidden`

## Summary

Clients with `clients.status = 'archived'` now drop out of default dashboard views and out of every cron loop, so pages load fewer rows and Meta Graph calls stop for them. Six clients were archived in prod on 2026-10-07 (4thefans, back-of-house, black-butter-records, junction-2, kick-off-club, the-columbo-group). They own 122 events and 30 published drafts, and none of those events is in the future. All checks go through `lib/db/client-status.ts`. Share links, portal login, and the portal load are unchanged. There are no Meta writes, no deleted data, no migration, and no change to `paused`.

## Scope / files

- Helper: `lib/db/client-status.ts`:
  - `ARCHIVED` and `ALL_CLIENT_STATUSES`
  - `activeClientFilter`
  - `loadArchivedClientIds` and `loadArchivedClientScope`, cached per Supabase client instance for 60s; a failed read hides nothing
  - `dropArchivedClientRows` and `dropArchivedEventRows`, which keep rows with no client
  - `isArchivedClientDraft`: the draft's `client_id`, else its column or JSON event
  - `logSkippedArchivedClients`
- Dashboard:
  - Clients list:
    - `listClientsServer` defaults to active + paused.
    - The dropdown gains "Archived" and "All".
    - `client-detail` Archive/Unarchive use `ARCHIVED`.
  - Today: `listEvents` / `listClients` take opt-in flags.
  - Events:
    - `listEventsServer` filters unless a `clientId` is passed or `includeArchivedClients` is set.
    - The events filter dropdown keeps a selected archived client.
  - Overview, plans page (plans and event picker), library tabs and "client archived" chip, Armed tab and badge.
  - `invoicing-server` uses `isArchivedClientStatus`.
- Crons:
  - `cron-eligibility` (rollup-sync, refresh-active-creatives) logs `skipped_archived_clients` / `skipped_archived_events`.
  - show-week-burst.
  - `listEligibleAccountPairs` (refresh-creative-insights).
  - The scan-enhancement-flags cron loop.
  - Budget-pacing and optimisation-tick loaders.
  - The ad-daily-insights account union keeps an account if any non-archived client, event, or launched ad set uses it.
  - mailchimp-eod-snapshot (including the Cirqlin leg) and sync-mailchimp-audiences.
  - `refreshDerivedFunnelPacingTargets`.
  - The portal snapshot runner (comment fixed).
- Tests:
  - `lib/db/__tests__/client-status.test.ts`
  - `lib/db/__tests__/archived-clients-hidden.test.ts`
  - `lib/db/__tests__/client-status-guard.test.ts`
  - `components/library/__tests__/library-rows.test.tsx`
  - Runner test updated.
  - `lib/__tests__/support/alias-hooks.mjs` + `supabase-stub.ts` let node tests import `@/` loaders against a fake DB.

## Validation

- [x] `npx tsc --noEmit` (no errors in touched files; pre-existing errors elsewhere)
- [x] `npm run build`
- [x] `npm test` (6791 node pass, 8 vitest pass)
- [x] The new loaders were run read-only against prod with a service-role client (selects only, no Meta). Results:
  - rollup-sync: 117 archived events dropped, 32 remain.
  - refresh-active-creatives: 30 dropped, 30 remain.
  - refresh-creative-insights: account pairs go from 16 to 10.
  - budget-pacing: 30 drafts skipped.
  - optimisation-tick: 0 skipped.
  - ad-daily-insights: 6 accounts dropped, 9 remain.

## Notes

- The guard test does not ban every `"archived"` literal, because the word is also a draft, plan, audience, ad plan, TikTok, and landing-page status. It flags a literal when its line mentions "client" or when the nearest `.from()` within 40 lines is `clients`.
- `client-pacing-alerts-server` already reads `status: "active"` only (paused excluded). It was left alone.
- The reporting rollup (`rollup-server.ts`) goes through `listEventsServer`, so it now hides archived clients' published events. That matches the reporting page's active-only client list.
- Not verified: the Meta calls per event in rollup-sync and refresh-active-creatives, and per account pair in refresh-creative-insights. Savings are estimated from cron schedules.
