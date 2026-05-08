## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `feat/cmd-k-global-search`

## Summary

Ships a global Cmd+K/Ctrl+K command palette for dashboard navigation so operators can jump directly to clients and events without walking the sidebar or client pages.

## Scope / files

- `app/api/internal/search-index/route.ts` - RLS-scoped client/event search index using the cookie-bound Supabase server client.
- `components/dashboard/cmd-k-palette.tsx` - keyboard-accessible modal palette with fuzzy search, grouped client/event results, route navigation, focus handling, and five-minute refresh.
- `components/dashboard/dashboard-nav.tsx` and `app/(dashboard)/layout.tsx` - global mount and discoverability button.
- `lib/dashboard/cmd-k-search.ts` and `lib/dashboard/__tests__/cmd-k-search.test.ts` - search ranking/highlighting logic and coverage for expected 4TF, Lock, and Manchester matches.

## Validation

- [ ] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test -- lib/dashboard/__tests__/cmd-k-search.test.ts`

## Notes

The API route intentionally uses the regular server Supabase client, not service role, so results stay scoped by the caller's RLS policies. The dashboard nav opens the palette through a local custom event rather than synthesizing a keyboard shortcut.
