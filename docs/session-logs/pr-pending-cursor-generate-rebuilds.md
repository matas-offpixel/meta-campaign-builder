## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/generate-rebuilds`

## Summary

Generate Suggestions rebuilds Step 5 from the audiences as they are now. Every existing row is replaced, including imported and operator-edited rows, and the 5-second undo restores the previous list. The first Generate on a draft that still has imported rows asks once. A row's displayed name follows a later group rename unless the operator typed the name; the stored name stays the launch name. A deleted group still shows the muted "audience removed" row until Generate.

## Scope / files

- `lib/wizard/import-edits.ts` — `mergeGeneratedWithImported` removed. Display name, confirm, and the lifetime budget mapping.
- `components/steps/budget-schedule.tsx` — Generate always replaces through the undo notice.
- `lib/types.ts` — `AdSetSuggestion.nameSource`, `CampaignDraft.generateReplaceImportedConfirmed`.
- `lib/wizard/use-campaign-draft.ts`, `components/wizard/wizard-shell.tsx`, `components/plan/meta-drawer.tsx` — the once-per-draft flag.
- `docs/session-logs/pr-974-meta-import-edits.md`, `docs/session-logs/pr-1022-cursor-generate-reflects-current-audiences.md` — the keep-imported-rows doctrine now applies only to adding audiences.

## Validation

- [x] `npm test` — 6657 node tests, 6653 pass, 4 skipped, 0 fail; vitest 6 pass
- [x] `npm run build`
- [ ] `npx tsc --noEmit` — covered by the production build

## Notes

Imported rows stay put when the operator adds an audience, because that step never writes Step 5. They are replaced only by clicking Generate.
