# Session log — asset queue launch three fixes

## PR

- **Number:** pending
- **URL:** (pending)
- **Branch:** `cursor/asset-queue-launch-three-fixes`

## Summary

Closes the queue → bulk-attach handoff gaps from PR #583: runtime-active campaign preselect, venue-derived 4thefans organiser URLs when sheet patterns are blank, preserved Dropbox filenames at prepare time, and step-2 auto-upload to Meta with aspect detection + asset mode binding.

## Scope / files

- `lib/bulk-attach/campaign-active.ts` — `effective_status`-first active check + tests
- `components/bulk-attach/campaign-multi-picker.tsx` — preselect active campaigns only
- `lib/clients/asset-queue/destination-url.ts` — client-aware organiser URL builder
- `app/api/clients/[id]/asset-queue/[queueId]/prepare/route.ts` — filename preservation + URL fallback
- `lib/clients/asset-queue/aspect-detect.ts` — filename + sharp image probe
- `lib/clients/asset-queue/storage-filename.ts` — sanitized storage paths
- `lib/clients/asset-queue/queue-creative-bind.ts` — wizard asset distribution + mode inference
- `app/api/clients/[id]/asset-queue/[queueId]/upload-to-meta/route.ts` — batch Meta upload
- `app/(dashboard)/clients/[id]/bulk-attach/{page,wizard}.tsx` — URL fallback + auto-upload UX

## Validation

- [x] `node --experimental-strip-types --test` on new unit tests (campaign-active, aspect-detect, destination-url)
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] Bournemouth re-prepare + Confirm & Launch smoke (prod)

## Notes

- Re-prepare required for existing rows with `0.jpg` paths to regain filename aspect hints.
- Auto-upload caps at 10 assets (aspect-priority trim); per-asset failures are tolerated.
- GIF assets may still fail Meta validation (jpeg/png only) — manual override path unchanged.
