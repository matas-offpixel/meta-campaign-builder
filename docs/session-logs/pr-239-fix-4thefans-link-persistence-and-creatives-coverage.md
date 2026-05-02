## PR

- **Number:** 239
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/239
- **Branch:** `fix/4thefans-link-persistence-and-creatives-coverage`

## Summary

Fixes the 4thefans linking flow so auto-confirmed matches can be persisted immediately, adds diagnostics across the 4thefans link and sync path, and gives operators a manual Active Creatives refresh that bypasses browser/framework caches.

## Scope / files

- 4thefans link discovery UI and bulk-link persistence route
- `event_ticketing_links` upsert diagnostics and post-link sync result handling
- 4thefans rollup-sync logging and ticket snapshot write diagnostics
- Venue and internal Active Creatives refresh controls and forced no-store responses

## Validation

- [x] `npx tsc --noEmit`
- [x] targeted ESLint
- [x] `node --test lib/dashboard/__tests__/rollup-sync-runner.test.ts lib/ticketing/__tests__/fourthefans-provider.test.ts`

## Notes

The Active Creatives fetch path already queries Meta by ad `effective_status` and includes active ads even when parent campaign/ad set status is paused-shaped; no 24h no-delivery filter was found in this path. A local live force-refresh attempt hit the auth proxy before the internal route, so production verification should use the merged UI button or an authenticated session.
