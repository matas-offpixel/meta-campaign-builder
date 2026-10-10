# Session log

## PR

- **Number:** 1054
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1054
- **Branch:** `cursor/mml-wizard-r3`

## Summary

Venue history was counting unpublished drafts and other ad accounts, so Puzzle won NX Newcastle. Published launches vote, one per event, and only on the chosen ad account. This event's newest published page wins. Step 4 is one audience tab per channel picked in step 1. A single 9:16 Meta video can also run on the plan's TikTok draft.

## Scope / files

- `lib/plan/mml-wizard.ts`, `lib/plan/channel-history.ts` — `channelHistoryVotes` counts `published`, and drafts only when a venue has no published launch. One vote per event per value. The venue tier also requires the draft's ad account. `eventLastLaunch` is that event's newest published page or Instagram, labelled "used on this event's last launch". Launches filed under another client are loaded by `event_id` (Folamour's published drafts are on IRONWORKS; the plan is Electric Brixton). `summariseChannelHistory` stays the unscoped reader.
- `components/wizard/mml-step-client.tsx` — Page and Instagram pass the plan's event into `resolveChannelField`.
- `components/wizard/mml-step-audiences.tsx` — step 4 tabs for the channels that are on. Meta is the creator's audiences step. TikTok is regional around the venue (the refine tab's region list); nationwide stays the budget step. Refine controls sit behind details. Google is the Search keywords tab. Each tab's dot is the channel's existing audience blockers.
- `components/wizard/mml-tiktok-reel-row.tsx`, `components/steps/creatives.tsx`, `components/wizard/mml-wizard.tsx` — a single 9:16 video gets "Also run on TikTok". On routes it through `campaign_plan_asset_routes`. Off disables the route. Identity is the step 1 TikTok identity. Ad text is the Meta caption cut to 100 characters. The CTA follows step 2.

## Validation

- [x] `npx tsc --noEmit` — 469 errors, none in the touched files
- [x] `npm run build`
- [x] `npm test` — node 7300 tests, 7296 pass, 4 skipped; vitest 8/8
- [x] ESLint on the touched files — warnings only in `components/steps/creatives.tsx`, all pre-existing

## Notes

Folamour (`/mml/8d70f724-ce3b-428d-be63-b46e78ff057d`). Page is NX LOVES (`259905047197071`) and Instagram is @nxloves (`17841460869627228`), both "used on this event's last launch". The ad account is NX Promoter (`act_606252931141334`), "used on 8 NX Newcastle campaigns".

Google is off for this plan, so step 4 shows Meta and TikTok only. Both dots are green. The TikTok tab says Interests because the linked draft already has a Derived from Meta group. The location was the country code `GB`; the tab seeded Newcastle upon Tyne (`2641673`). The line under it is "Regional · nationwide decided by budget in step 6".

A draft 9:16 video showed the TikTok row with identity NX Loves, call to action Book now, and "✓ On TikTok · NX Loves". That creative was deleted and the route disabled. The Meta draft is Grid and Story again. Nothing was launched.

Budget split, assign, review, and the launch path are later rounds.
