# Session log — asset queue Dropbox folder cap 2 GB

## PR

- **Number:** 590
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/590
- **Branch:** `cursor/asset-queue-folder-cap-2gb`

## Summary

Raises asset queue Dropbox folder total size cap from 500 MB to 2 GB for presenter video folders (Kentish Town case). Per-file 100 MB cap unchanged.

## Validation

- [x] `node --experimental-strip-types --test lib/clients/asset-queue/__tests__/dropbox.test.ts`
- [ ] Kentish Town Presenter videos re-prepare smoke
