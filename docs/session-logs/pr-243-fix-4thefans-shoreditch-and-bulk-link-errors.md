## PR

- **Number:** 243
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/243
- **Branch:** `fix/4thefans-shoreditch-and-bulk-link-errors`

## Summary

Fixes Shoreditch 4thefans matching by scoring venue aliases from comma-separated provider locations, and makes bulk-link results distinguish persisted-link failures from post-link ticket-sync warnings.

## Scope / files

- Ticketing link-discovery venue alias scoring and Shoreditch regression tests
- Bulk-link per-event sync retry, explicit logging, and aggregate reason logging
- Discovery UI summary copy, event-name sync warnings, and retry sync action

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "lib/ticketing/link-discovery.ts" "lib/ticketing/__tests__/link-discovery.test.ts" "app/api/clients/[id]/ticketing-link-discovery/bulk-link/route.ts" "components/dashboard/clients/ticketing-link-discovery.tsx"`
- [x] `node --test lib/ticketing/__tests__/link-discovery.test.ts`

## Notes

Could not pull Vercel logs locally because the `vercel` CLI is not installed in this environment. This PR adds `[bulk-link]` per-event and aggregate logs so the next production run can be filtered alongside existing `[fourthefans-sync]` logs.
