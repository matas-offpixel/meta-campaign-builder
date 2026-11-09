# Session log

## PR

- **Number:** 1146
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1146
- **Branch:** `cursor/drive-ui`

## Summary

The operator event page and the MML intake can see the Drive export that already files renders: the folder map, link or create, the upload's folder question, share with the promoter, and From the Lab. Client pages do not get it.

## Scope / files

- Drive panel, setup, upload question, asset-board links, From the Lab
- `lib/drive/panel.ts`, `lib/drive/setup.ts`, `lib/drive/place-upload.ts`
- Event page, render rows, clip upload, MML intake
- Frames CLS5, CLS5b, CLS6, CLS7, CLS8, CLS9

## Validation

- [x] `node --test lib/drive/__tests__/panel.test.ts`
- [x] frames CLS5–CLS9, two matching Ubuntu runs (pair 0; CLS1–CLS4 unchanged)
- [ ] `npm test` and `npm run build` on CI

## Notes

No migration. The Drive copy is never what launch reads, and a failed copy does not disable Launch. Share runs only after the confirm.
