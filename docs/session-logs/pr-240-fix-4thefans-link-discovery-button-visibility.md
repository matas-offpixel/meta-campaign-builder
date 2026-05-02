## PR

- **Number:** 240
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/240
- **Branch:** `fix/4thefans-link-discovery-button-visibility`

## Summary

Surfaces the ticketing auto-match flow directly from the 4thefans connected-provider card so operators can discover and open the link discovery UI without knowing the hidden route.

## Scope / files

- Ticketing connection card CTA and match-count badge
- Client detail server loader for linked/unlinked ticketing counts
- Ticketing link discovery page title copy

## Validation

- [x] `npx tsc --noEmit`
- [x] `npx eslint "app/(dashboard)/clients/[id]/page.tsx" "app/(dashboard)/clients/[id]/ticketing-link-discovery/page.tsx" "components/dashboard/clients/client-detail.tsx" "components/dashboard/clients/ticketing-connections-panel.tsx"`

## Notes

Manual route for testing: `/clients/[id]/ticketing-link-discovery`.
