# Session log

## PR

- **Number:** 275
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/275
- **Branch:** `feat/share-creative-insights-and-funnel-pacing`

## Summary

Adds Creative Insights and Funnel Pacing tabs to client-scope public shares, reusing the internal dashboard components with service-role read paths scoped by the token-resolved client.

## Scope / files

- `report_shares` visibility flags migration.
- Shared dashboard tab shell for internal and public client dashboards.
- Service-role mode for Creative Insights and Funnel Pacing loaders.
- Public share route wiring and public chrome adjustments.

## Validation

- [x] `npx tsc --noEmit`
- [ ] `npm run build` (when applicable)
- [x] `npm test -- --test-name-pattern='selectLatestSnapshotsByEvent|buildCreativeTagTiles|funnel'`
- [x] `npx eslint 'app/share/client/[token]/page.tsx' 'app/(dashboard)/clients/[id]/dashboard/page.tsx' 'components/dashboard/dashboard-tabs.tsx' 'components/share/client-portal.tsx' 'components/dashboard/clients/creative-patterns-panel.tsx' 'components/dashboard/clients/funnel-pacing-section.tsx' 'lib/db/client-portal-server.ts' 'lib/db/report-shares.ts' 'lib/reporting/creative-patterns-cross-event.ts' 'lib/reporting/funnel-pacing.ts' 'lib/reporting/active-creatives-refresh-runner.ts'`

## Notes

Migration `073` was applied and recorded in production. Existing client token `E8bYmoAxttBNWy3o` has both new flags set to true via defaults.
