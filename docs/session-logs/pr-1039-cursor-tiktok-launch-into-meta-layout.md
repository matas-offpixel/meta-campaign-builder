# TikTok: "What do you want to do?" on the Campaign step, Meta layout

## PR

- **Number:** 1039
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1039
- **Branch:** `cursor/tiktok-launch-into-meta-layout`

## Summary

UI only. The TikTok launch target moves from a "Launch into" box on Review to the Campaign step, laid out like the Meta campaign creator: three tiles (Create new campaign / Add to existing campaign / Add to existing ad group), a Selected campaign card per pick, the "What should happen under each campaign at launch?" sub-tiles (Create new ad group / Attach ads to all existing ad groups) and the Attach-all note. Steps an attach mode doesn't use collapse to one "Inherited from …" line. Review keeps a read-only "Launching into" summary with an Edit link. Launch as starts paused in every attach mode. A published draft shows the tiles read-only. The published card's live line states when the launch ran, not the draft's current schedule start.

No change to `lib/tiktok/attach/plan.ts`, `lib/tiktok/write/*`, any route, the draft shape or a request body. The #1036 golden and attach tests pass unchanged.

## Scope / files

- `components/tiktok-wizard/launch-mode-section.tsx` (new): tiles, campaign picker, Selected campaign cards (objective badge, ACTIVE/PAUSED, id, raw objective, CBO, inherited pixel/event, Smart+ blocking badge, ×), sub-tiles, Attach-all note, ad-group picker. `compact` for the canvas drawer. Read-only once published. Same `/api/tiktok/attach-targets` reads as before.
- `components/tiktok-wizard/launch-into.tsx`: deleted (no users left).
- `components/tiktok-wizard/steps/campaign-setup.tsx`: the section at the top (wizard surface). Attach modes hide name, objective, sales destination and the pixel note; `attach_campaign` keeps goal and bid (they are the new ad groups') with goal options from the picked campaign's objective; ads-only hides all of it.
- `components/tiktok-wizard/steps/{audiences,budget-schedule,assign-creatives}.tsx`: ads-only modes render the inherited note instead of the step. `attach_campaign` keeps Budget (it is each new ad group's budget, `resolveTikTokAdGroupBudget`) with a note.
- `components/tiktok-wizard/inherited-step-note.tsx` (new).
- `components/tiktok-wizard/steps/review-launch.tsx`: picker removed; "Launching into" summary (`tikTokAttachConfirmMessage`) with Edit → step 1; Launch as defaults paused in attach modes; live success line from `launchedAt`.
- `components/plan/tiktok-drawer-details.tsx`: compact tiles inside the details disclosure (plan-linked drafts; they still launch paused from the canvas).
- `lib/tiktok-wizard/launch-mode.ts` (new): tile copy, tile ↔ launchMode, mode-switch patch, paused default, inherited-step notes, card facts.
- `lib/tiktok-wizard/validation.ts`: wizard checks that don't apply to the mode are skipped (objective checks in attach modes; audience, budget, schedule, assignment in ads-only), so a collapsed step can't block Continue.
- `lib/tiktok-wizard/launch-live.ts`: `tikTokLaunchedLiveDescription`.
- Tests: `lib/tiktok-wizard/__tests__/launch-mode.test.ts` + `render-launch-mode.tsx` (static render: Review shows the summary not the picker, sub-tile pressed, card facts, Smart+ badge, published read-only).

## Validation

- [x] `npx tsc --noEmit` (351, all pre-existing; none in touched files)
- [x] `npm run build`
- [x] `npm test` (7,081 node: 7,077 pass, 4 skipped pre-existing; 8 vitest)
- [x] `npx eslint` on touched files (only pre-existing unused-import warnings)

## Notes

- "Add to existing campaign" sets `attach_campaign` with "Create new ad group" pre-selected (no pending sub-mode: the draft shape is frozen). Clicking the tile again keeps the current sub-tile.
- Entering an attach mode from "new" stores `launchPaused: true`; Review also starts paused when `launchPaused` is unset in an attach mode. The request body still sends the explicit boolean.
- Selected-tile border: `app/globals.css` sets an unlayered `* { border-color }`, which beats Tailwind v4 border-colour utilities app-wide, so Meta's selected tile border doesn't show either. The TikTok tile adds `ring-1 ring-foreground`. `globals.css` untouched (shared).
- Follow-up: Review's informational "Wizard checks" cards (`buildTikTokPreflightChecks`) still show Budget > 0 / Every creative assigned as needing attention in ads-only modes. They don't disable Launch.
