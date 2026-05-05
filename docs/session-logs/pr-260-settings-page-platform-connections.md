## PR

- **Number:** 260
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/260
- **Branch:** `creator/settings-page-platform-connections`

## Summary

Settings now owns account sign-out and platform connection management for Facebook, TikTok, Google Ads, and ticketing, giving Meta App Review and onboarding a single clean OAuth surface while keeping campaign wizard step 0 focused on selecting already-connected Meta entities.

## Scope / files

- `app/(dashboard)/settings/page.tsx` replaces the placeholder with Account, Platform Connections, and Workspace sections.
- `app/(dashboard)/settings/connections/page.tsx` exposes a focused platform connections route.
- `lib/settings/connection-status.ts` aggregates connection status from existing user-scoped OAuth and ticketing tables without new migrations.
- `components/settings/connection-card.tsx`, `components/settings/platform-connections-section.tsx`, and `components/settings/sign-out-button.tsx` render status badges, accounts, scopes, reconnect/disconnect/details actions, Facebook reconnect polling, and Settings-owned sign-out.
- `components/steps/account-setup.tsx` removes Facebook connect/reconnect controls and replaces connection issues with a Settings link banner while preserving ad account and pixel pickers.
- `components/library/campaign-library.tsx` removes the library-header logout button.

## Validation

- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`

## Notes

- Scoped ESLint passed for touched files.
- Repo-wide `npm run lint` still fails on pre-existing `main` lint violations outside this PR; no touched-file diagnostics were introduced.
- `/settings` and `/settings/connections` smoke-tested locally without an authenticated browser session; both reached the app and redirected to `/login` as expected. Authenticated OAuth click-through needs browser credentials and was not manually completed here.
