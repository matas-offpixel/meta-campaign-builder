# Session log: multi-channel tier table integration rollback

## PR

- **Number:** 284
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/284
- **Branch:** `fix/multi-channel-tier-table-integration`

## Summary

Rolls back the standalone multi-channel ticket entry table from PR #282
and folds channel data into the existing ticket tier breakdown table.
The database model and migrations 076/077 stay intact; the UI now shows
compact per-channel allocation/sold details on each tier row, with a
small edit popover for manual channels when the venue share token is
editable.

## Scope / files

- Removed `components/dashboard/events/multi-channel-ticket-entry-card.tsx`
  and unmounted it from `components/share/venue-full-report.tsx`.
- Extended `components/dashboard/events/ticket-tiers-section.tsx` with
  channel allocation, channel sold, and edit columns.
- Added `components/dashboard/events/ticket-tier-channel-breakdown.tsx`
  for compact channel row rendering and the inline edit popover.
- Threaded edit props through `components/share/venue-event-breakdown.tsx`
  from the full venue report.
- Restored `AdditionalTicketEntriesCard` visibility in the full venue
  report's Additional entries section.
- Added share-token additional-ticket-entry routes so the restored card
  can load/write on editable venue share pages.

## Goals coverage

1. **Remove standalone MultiChannelTicketEntryCard:** done; import,
   mount, and component file removed.
2. **Keep schema:** done; migrations 076/077 and table helpers remain.
3. **Extend existing tier table:** done; `TicketTiersSection` now adds
   compact channel allocation/sold columns using `channel_breakdowns`.
4. **Edit channels inline:** done; each editable tier row has an Edit
   button opening a small modal-style popover with sold inputs and
   revenue override for manual channels. Automatic channels display but
   are disabled.
5. **Restore marketing budget edit:** retained the PR #282
   `VenueBudgetClickEdit` section on the venue report.
6. **Restore Additional Ticket Sales:** restored the card in the full
   venue report and added share-token API routes so it works outside
   cookie-auth contexts.
7. **4TF fallback:** preserved the existing server-side fallback in
   `buildTierChannelBreakdownMap` / `applyTierChannelBreakdowns`, so 4TF
   sold comes from `event_ticket_tiers.quantity_sold` when there is no
   `tier_channel_sales` row.

## Validation

- [x] `npx tsc --noEmit`
- [x] Targeted `npx eslint` on modified files

## Notes

The ticket-tier table now carries channel detail without adding a new
section. Manual channel edits write to `tier_channel_sales` using the
existing UPSERT semantics; allocation remains display-only in this pass
because the requested quick visual called for sold/revenue editing from
the tier row.
