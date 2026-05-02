## PR

- **Number:** 244
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/244
- **Branch:** `fix/4thefans-rate-limit-and-attribution-bugs`

## Summary

Fixes three 4thefans follow-up issues: rate-limit handling/backoff, false-positive campaign-level matching, and stage-label attribution for Last 32 / knockout rows.

## Scope / files

- 4thefans API client/provider retry handling for 429 responses
- Bulk-link post-response background sync throttled to concurrency 2 with a 500ms launch gap
- Ticketing connection retry UI for rate-limit countdowns and manual retry
- Link-discovery umbrella campaign detection and no-opponent threshold tightening
- Stage-label extraction for Last 32 / Round of 16 / Quarter Final / Semi Final / Final
- Regression tests for London umbrella rows and Manchester/Bristol stage matching

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "lib/ticketing/fourthefans/client.ts" "lib/ticketing/fourthefans/provider.ts" "lib/ticketing/link-discovery.ts" "lib/db/event-opponent-extraction.ts" "app/api/clients/[id]/ticketing-link-discovery/bulk-link/route.ts" "app/api/clients/[id]/ticketing-link-discovery/route.ts" "app/api/ticketing/connections/[id]/route.ts" "components/dashboard/clients/ticketing-link-discovery.tsx" "components/dashboard/clients/ticketing-connections-panel.tsx" "lib/ticketing/__tests__/link-discovery.test.ts" "lib/ticketing/__tests__/fourthefans-provider.test.ts" "lib/db/__tests__/event-opponent-extraction.test.ts"`
- [x] `node --test lib/ticketing/__tests__/link-discovery.test.ts lib/db/__tests__/event-opponent-extraction.test.ts lib/ticketing/__tests__/fourthefans-provider.test.ts`

## Notes

The bulk-link API now returns after link persistence and schedules ticket sync in `after()`, so immediate UI feedback reports queued/throttled background sync rather than waiting through provider backoff.
