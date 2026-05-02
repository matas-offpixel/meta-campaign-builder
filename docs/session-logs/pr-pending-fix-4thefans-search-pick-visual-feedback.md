## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `fix/4thefans-search-pick-visual-feedback`

## Summary

Improves link discovery search-pick feedback so selected auto and manual 4thefans picks are visibly distinct at row level.

## Scope / files

- Tracks whether a row selection came from auto-match or manual search
- Shows selected auto/manual picks as prominent chips above the row search input
- Uses green success styling for manual search picks and blue styling for auto matches
- Adds a clear control to selected chips
- Replaces the plain manual score-column text with a green `Manual pick: <id>` badge

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "components/dashboard/clients/ticketing-link-discovery.tsx"`
- [x] `node --test lib/ticketing/__tests__/event-search.test.ts`

## Notes

This is a visual feedback update only. The search algorithm and bulk-link payload are unchanged.
