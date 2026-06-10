# Session log template

## PR

- **Number:** pending
- **URL:** (pending)
- **Branch:** `cursor/asset-queue-per-file-cap-200mb`

## Summary

Raise asset queue Dropbox per-file download cap from 100 MB to 200 MB to match the `campaign-assets` Supabase Storage bucket limit (migration 118).

## Scope / files

- `lib/clients/asset-queue/dropbox.ts` — `MAX_SINGLE_FILE_BYTES` + error messages
- `lib/clients/asset-queue/__tests__/dropbox.test.ts` — 150 MB pass, 250 MB reject

## Validation

- [x] `node --test lib/clients/asset-queue/__tests__/dropbox.test.ts`
- [ ] Bournemouth Presenter videos prepare (post-merge)

## Notes

`MAX_FOLDER_BYTES` (2 GB) unchanged from PR #590.
