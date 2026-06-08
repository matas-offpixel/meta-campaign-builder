# Session log template

## PR

- **Number:** 591
- **URL:** (591)
- **Branch:** `cursor/umbrella-bulk-attach-handoff`

## Summary

Wire umbrella asset-queue rows through the same `?queueId=` bulk-attach handoff as single-venue rows. After "Confirm copy" in the umbrella review modal, "Open Bulk Attach" routes to `/clients/[id]/bulk-attach?queueId=…` with caption, CTA, venue codes, and Dropbox asset auto-upload pre-filled. Confirmed rows merge `confirmed_overrides` from the modal.

## Scope / files

- `components/dashboard/clients/asset-queue-panel.tsx` — Open Bulk Attach link with `queueId`
- `app/(dashboard)/clients/[id]/bulk-attach/page.tsx` — accept `confirmed` status; umbrella `queueContext`
- `app/(dashboard)/clients/[id]/bulk-attach/wizard.tsx` — umbrella campaign preselect, banner, empty URL default
- `lib/clients/asset-queue/queue-handoff.ts` — handoff helpers + umbrella default copy constant
- `lib/clients/asset-queue/copy-generator.ts` — umbrella venue-wide fallback copy
- `app/api/.../prepare/route.ts` — skip URL pre-fill for umbrella prepare
- `app/api/.../upload-to-meta/route.ts` — allow `confirmed` status uploads
- `lib/clients/asset-queue/__tests__/queue-handoff.test.ts` — unit tests

## Validation

- [x] `node --test lib/clients/asset-queue/__tests__/queue-handoff.test.ts`
- [x] `npm run build`
- [ ] Haiti Fixture end-to-end (post-merge, Matas)

## Notes

Single-venue `591` handoff and standalone bulk-attach (no `queueId`) unchanged. Umbrella URL stays operator-editable; no per-venue URL auto-substitution.
