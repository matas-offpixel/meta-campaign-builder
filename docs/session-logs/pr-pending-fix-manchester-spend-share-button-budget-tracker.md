# Session log — Manchester WC26 spend 4× fix + share button + budget tracker errors

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/manchester-spend-share-button-budget-tracker`

## Summary

Three production bugs surfaced on /clients/37906506-56b7-4d58-ab62-1b042e2b561a/venues/WC26-MANCHESTER after PR #287/#080 restored real per-fixture dates. (1) The WC26 opponent allocator was grouping siblings by event_code + event_date; with 4 distinct dates the Manchester fixtures each landed in their own solo group, writing full venue spend to every row → 4× over-attribution (£19,396 shown instead of ~£4,848). Fix: drop the event_date filter from the sibling lookup — the opponent allocator handles per-fixture attribution by campaign-name matching, so event_date is not needed. (2) The Share button was already wired correctly in page.tsx post-PR-#353 (showClientShareButton prop + shareClientId). No source change needed; the prop threading is confirmed correct. (3) The Daily Spend Tracker refresh showed a generic "1 failed" message on Meta errors. Fix: surface the actual Meta error code/message (MetaApiError.code + message) in the reasonLabel, and thread firstFailureReason into the button status display so operators can act on "Meta #100: Invalid id" rather than "1 failed".

## Scope / files

- `lib/dashboard/venue-spend-allocator.ts` — remove event_date gate from WC26 sibling lookup; update comment; remove dead `no_event_date` type union member
- `lib/insights/meta.ts` — `fetchVenueDailyBudget` catch block: use actual MetaApiError code + message in reasonLabel
- `components/share/client-refresh-daily-budgets-button.tsx` — capture firstFailureReason per result; thread into status display alongside "N failed"
- `lib/dashboard/__tests__/venue-spend-allocator.test.ts` — NEW: 4-scenario Manchester multi-date regression test (generic-only, mixed, all-specific, solo bug illustration)

## Validation

- [x] `npm run lint` — no new errors in modified files (62 pre-existing warnings unchanged)
- [x] `npm run build` — clean
- [x] `npm test` — 815 tests, 814 pass, 1 pre-existing skip, 0 fail

## Notes

- Post-merge: trigger re-allocation on the 4 Manchester fixtures via the DevTools snippet in the task description (rollup-sync?force=true for each UUID).
- WC26-LONDON-* groups are NOT regressed: they share an event_code (e.g. WC26-LONDON-OUTERNET) with one event per sub-venue; removing the event_date filter doesn't change their solo pass-through behaviour.
- The share button was already correct in committed source. If it still appears hidden after deploy, check Vercel edge-cache or open a separate repro with network tab.
