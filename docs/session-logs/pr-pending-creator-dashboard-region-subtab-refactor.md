## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `creator/dashboard-region-subtab-refactor`

## Summary

Reorganises internal client dashboard and venue report pages around region/venue sub-tabs:

- Client dashboard keeps the existing region buckets and adds Events / Creative Insights / Funnel Pacing subtabs.
- Venue reports add Performance / Creative Insights / Funnel Pacing subtabs.
- Creative patterns can now be scoped by region bucket or venue event code.
- Funnel Pacing is a placeholder surface for the derived-benchmark follow-up PR.

## Scope / files

- `lib/dashboard/client-regions.ts`
  - Extracts the existing 4thefans region bucketing logic from `ClientPortal`.
- `components/share/client-portal.tsx`
  - Reuses the shared region helper.
- `app/(dashboard)/clients/[id]/dashboard/page.tsx`
  - Adds URL-driven region/subtab navigation.
- `app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx`
  - Adds venue report subtabs.
- `lib/reporting/creative-patterns-cross-event.ts`
  - Adds optional `regionFilter` applied before event IDs are derived.
- `components/dashboard/clients/sub-tab-bar.tsx`
  - Shared subtab pill navigation.
- `components/dashboard/clients/funnel-pacing-placeholder.tsx`
  - Placeholder for PR 3.
- `components/dashboard/clients/creative-patterns-panel.tsx`
  - Region/venue-scoped creative pattern embed.
- `app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx`
  - Legacy route now redirects to `/clients/{id}/dashboard?tab=insights`.
- `components/dashboard/clients/client-detail.tsx`
  - Updates old Creative Patterns links to the dashboard insights tab.

## Validation

- [x] `npm run lint -- 'app/(dashboard)/clients/[id]/dashboard/page.tsx' 'app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx' 'app/(dashboard)/dashboard/clients/[slug]/patterns/page.tsx' components/dashboard/clients/sub-tab-bar.tsx components/dashboard/clients/funnel-pacing-placeholder.tsx components/dashboard/clients/creative-patterns-panel.tsx components/dashboard/clients/client-detail.tsx components/share/client-portal.tsx lib/dashboard/client-regions.ts lib/reporting/creative-patterns-cross-event.ts`
- [x] `npx tsc --noEmit`

## Notes

No migrations, public auth allow-list changes, or per-event share report paths are touched.
