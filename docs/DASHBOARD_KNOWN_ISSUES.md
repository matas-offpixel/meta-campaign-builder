# Dashboard Known Issues

Last updated: 2026-04-29

## Production Follow-Ups

- **Allocator re-sync required after PR #159:** Manchester and Margate currently have null `event_date` venue groups. Before PR #159, they skipped allocation, leaving allocated spend at £0 while raw per-event rollups were duplicated across all four events. After merge, trigger rollup sync for both venue groups and verify allocated spend/clicks reconcile to Meta within roughly 1%.
- **Full 4theFans venue reconciliation still needs post-merge confirmation:** Bristol is verified, but the remaining 4theFans multi-event venue groups should be checked after the null-date allocator fix lands. Priority venues: Manchester, Margate, Birmingham, Brighton, Bournemouth, Newcastle.
- **Typecheck baseline is currently blocked outside dashboard scope:** `npx tsc --noEmit` fails on `lib/tiktok/__tests__/share-render.test.ts` generic mock typings on current `main`. Dashboard-targeted lint and tests passed for the overnight PRs.
- **Full lint baseline is currently blocked outside dashboard scope:** `npm run lint` reports existing errors in unrelated Meta/auth/wizard/hook files. Targeted lint passed for files changed in the overnight PRs.

## Deferred Polish

- **Daily Tracker legacy JSON surface:** the active editable tracker still exists in `components/dashboard/events/daily-tracker.tsx`. The old share component was removed, but `dailyEntries` remains in the client portal payload for compatibility. Remove that API field only after confirming no external consumers rely on it.
- **Token write endpoint audit:** `/api/share/client/[token]/daily` appears unused by current in-repo UI. Check production logs before deprecating or removing it.
- **Performance profiling:** React DevTools profiling for expanded venue rows was not completed in this automated pass. Focus on hover state, expanded chart render, and active creative sections.
- **Mobile and print pass:** 1024px/768px viewport checks and print/PDF stylesheet work remain to be done with a browser session.
- **Client-readiness empty states:** some data-missing copy still needs a product pass to distinguish unsynced data, missing campaigns, and genuine zero activity.
- **Error boundaries:** per-venue and trend-chart error isolation remains a candidate Tier 4 PR.

## Verification Checklist For Morning

- Merge and deploy PR #159, then re-sync Manchester and Margate.
- Re-run the multi-event venue reconciliation query for all 4theFans venue groups.
- Open `/clients/[id]/dashboard` and `/share/client/[token]` for 4theFans and expand representative venues.
- Check the trend chart daily/weekly toggle, all six metric pills, and tooltip readability.
- Open at least one full venue report via the venue share link and confirm branded styling.
- Use "Refresh daily budgets" and confirm the button reports budget/null/error counts accurately.
