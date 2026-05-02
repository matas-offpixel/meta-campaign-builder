## PR

- **Number:** 234
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/234
- **Branch:** `chore/cron-fixed-london-times`

## Summary

Updates Vercel cron schedules so ticketing, creative insights, rollups, active creatives, and TikTok breakdowns run in staggered UTC windows that leave the dashboard fresh before the 8am, 12pm, 4pm, 8pm, and 12am London BST client checks.

## Scope / files

- `vercel.json` cron schedule replacement.

## Validation

- [ ] `npx tsc --noEmit` (not needed; config-only change)
- [ ] `npm run build` (not run; config-only change)
- [ ] `npm test` (not needed; config-only change)
- [x] `node -e 'JSON.parse(...)'` for `vercel.json`

## Notes

During winter GMT, these fixed UTC schedules shift to 6am, 10am, 2pm, 6pm, and 10pm London time. That seasonal shift is accepted instead of maintaining DST-aware schedules.
