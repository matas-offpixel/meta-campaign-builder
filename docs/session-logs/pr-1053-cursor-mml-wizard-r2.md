# Session log

## PR

- **Number:** 1053
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1053
- **Branch:** `cursor/mml-wizard-r2`

## Summary

Client-wide defaults put Puzzle on an NX Newcastle plan, because Electric Brixton spans several venues and ad accounts. Channel picks now prefer drafts for the event's venue, then the chosen ad account, then the client, then `lib/clients/channel-defaults.ts`. A page that is not on the ad account's Page list is shown and left unselected. Step 2 is the campaign creator's objective cards, applied to every selected channel. Step 3 mounts the Meta optimisation step under the account benchmarks.

## Scope / files

- `lib/plan/mml-wizard.ts`, `lib/plan/channel-history.ts`, `app/api/plan/channel-history/route.ts` — venue-scoped history. Page and Instagram are read from `draft_json.creatives[].identity` (`pageId`, then `instagramActorId` / `instagramAccountId`). `settings.pageId` is unused. `settings.metaPageId` / `settings.metaIGAccountId` are fallbacks only when no creative has the field.
- `components/wizard/mml-step-client.tsx` — provenance under each pick. A page missing from the account's Page list gets an amber "Not on this ad account's Pages" note and an empty Page combobox.
- `components/wizard/mml-step-objective.tsx`, `lib/plan/adapters/meta.ts`, `lib/types.ts` — one objective card sets Meta (objective, optimisation goal, CTA) and TikTok when `mapIntentToTikTokObjective` has an equivalent. Awareness has none, so TikTok keeps its own picker. On-sale applies Purchase / Book now once (`settings.mmlObjectiveChosen`).
- `components/wizard/mml-wizard.tsx`, `components/plan/plan-workspace.tsx` — step 3 mounts `OptimisationStrategy` for the linked Meta draft, with `CanvasTarget` above it.

## Validation

- [x] `npx tsc --noEmit` (no errors in the touched files)
- [x] `npm run build`
- [x] `npm test`

## Notes

Folamour (`8d70f724-ce3b-428d-be63-b46e78ff057d`, NX Newcastle, ad account `act_606252931141334`). Page and Instagram are read from `creatives[].identity` (`pageId`, then `instagramActorId`). `settings.pageId` was unused. The venue's most-used page is Puzzle `103824529223927` ("used on 10 NX Newcastle campaigns") and Instagram `@puzzleofficialuk` ("used on 8"). That page is also the Electric Brixton client default. The ad account is NX Promoter ("used on 24 NX Newcastle campaigns"). TikTok is Electric Group and identity NX Loves ("used on 3 NX Newcastle campaigns" each).

The completed Page list for that ad account is 836 pages (personal 834, client 115, promote 52, business 7) and includes Puzzle, so the Page and Instagram are selected. A shorter list that omitted Puzzle — personal `/me/accounts` failed, 126 pages, promote 52 — left the Page unselected with the amber "Not on this ad account's Pages" note. The combobox has no open prop (`components/ui` is shared); the empty combobox plus that note is the picker.

On-sale Folamour opens Objective on Purchase (Book now). Awareness has no TikTok objective, so that card leaves TikTok on its own picker. Optimisation mounts the Meta step under the canvas target. Folamour's strategy is a preset, so the step shows that preset rather than the strategy card's own benchmark block. Audiences, the TikTok creative expander, budget split, and launch stay for later rounds.
