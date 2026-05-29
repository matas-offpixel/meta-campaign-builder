# Session log — share view Pacing + PvA exposure

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/share-view-pacing-pva-exposure`

## Summary

Exposed the Stats / Pacing / Performance vs Allocation 3-state toggle on the
public share route `/share/client/[token]` (previously Stats-only). Pacing
view ships with softened client-facing copy (`tonality="client"`); PvA view
is unchanged. Today alerts remain internal-only, isolated to the
auth-guarded `(dashboard)` route group.

## Scope / files

- `app/share/client/[token]/page.tsx` — pass `lifetimeMetaByEventCode` to `DashboardTabs`
- `components/dashboard/dashboard-tabs.tsx` — build pacing rows for share; show toggle with token-scoped localStorage key
- `components/dashboard/clients/client-stats-view-toggle.tsx` — `storageKey` + `tonality` + `isShare` props
- `components/dashboard/clients/client-pacing-view.tsx` — `tonality` + `isShare` props; client copy lookup; non-linked rows on share
- `components/dashboard/clients/client-allocation-view.tsx` — `isShare` prop; non-linked rows on share

## Workstream D audit

`ClientPacingAlerts` is imported only in `app/(dashboard)/today/page.tsx`.
That route is inside the `(dashboard)` group, which requires an authenticated
Supabase session. No `app/share/**` route imports or renders any Today
component. Confirmed by grep.

## Validation

- [x] `eslint` — zero issues on changed files
- [x] `npx tsc --noEmit` — zero new errors (two pre-existing test-fixture gaps in unrelated test files)
- [ ] `npm run build`

## Notes

- Token-scoped localStorage key (`share-dashboard-toggle-{token}`) is orthogonal
  to the internal `client-dashboard-toggle-{clientId}` key — no collision risk.
- Pacing rows on share render as `<div>` (no link) because the client share
  token doesn't resolve to per-venue internal routes. PvA rows same.
- No new Supabase queries. `lifetimeMetaByEventCode` was already in the
  `loadClientPortalData` return value; we just started passing it through.
