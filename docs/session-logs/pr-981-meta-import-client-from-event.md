# Session log

## PR

- **Number:** 981
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/981
- **Branch:** `cursor/meta-import-client-from-event`

## Summary

Electric Brixton has two Meta ad accounts and `clients.meta_ad_account_id` holds one, so an import on the other account stopped before an event could be chosen. The importer now lists the operator's events that already run on the campaign's account and takes the client from the event they pick.

## Scope / files

- `lib/meta/import/event.ts` — list by `events.meta_ad_account_id`; `[CODE]` suggestion only when the singular client column resolves
- `lib/meta/import/save.ts` — save uses the event's `client_id`; a null account lookup no longer 400s
- `components/meta/meta-import-picker.tsx` — empty list says to create the event first

## Validation

- [x] `npm test` — 6296 pass, 3 skipped
- [x] `npm run build`
- [ ] check runs (reported in the thread, not in this file)

## Notes

No migration. The singular client column is still wrong everywhere else it is read. The importer writes nothing to Meta.
