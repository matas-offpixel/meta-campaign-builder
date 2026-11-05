# Creative Lab M1: schema, caption facts, judge

## PR

- **Number:** 1077
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1077
- **Branch:** `cursor/creative-lab-m1`

## Summary

Creative Lab M1 adds the data model, the caption fact check and the weekly judge for artist-clip × caption test rounds. Migration 197 adds the Lab tables and widens three CHECK constraints so a `caption_style` tag can be written. The learning join now reads an ad's tags by id and by name together. `lib/creative-lab/` holds the rights gate, ad naming, the caption validator and the judge. `scripts/creative-lab-judge.mts` prints the judge's table, dry run by default. No Meta or TikTok calls, no rendering, no UI, no launch changes, no tier rows written, and `auto-tagger.ts` is unchanged.

**Migration 197 is unapplied.** Matas applies.

## Decisions (from the review rulings)

1. `tagsForAd` (`lib/learning/joins.ts`) returns the union of the tags found by `meta_ad_id` and by event + ad name. An AI tag by name and a `caption_style` tag by `meta_ad_id` are both reported. `via` is `meta_ad_id` when any tag came by id. This is the only `lib/learning` change.
2. A result is the ad set's optimisation event: `promoted_event`, else `optimization_goal`, counted from `actions` with `firstPresentAction`. With neither: registrations in the registration stage, else purchases. Every verdict stores `result_metric`.
3. A round ad is judged across every ad set it runs in. Its share is its spend over those ad sets' spend. Its fair share is the spend-weighted mean of 1 ÷ ads per ad set. Its cost per result is pooled.

## Scope / files

- `supabase/migrations/197_creative_lab.sql`: `creative_lab_artists`, `_event_facts`, `_clips`, `_captions`, `_rounds`, `_round_ads`, `_round_ad_launches`, `_renders`. Owner-only RLS on `user_id`. The CHECKs on `creative_tags.dimension`, `creative_tags.source` and `creative_tag_assignments.source` gain `caption_style` / `creative_lab`.
- `lib/db/database.types.ts`: the eight tables, hand-added.
- `lib/db/creative-tags.ts`: `creative_lab` added to the tag and assignment source types.
- `lib/learning/joins.ts` + test: the union.
- `lib/creative-lab/tags.ts`: `CREATIVE_LAB_DIMENSIONS` (kept apart from `CREATIVE_TAG_DIMENSIONS`, which the auto-tagger's prompt is built from). `assignCaptionStyleTag` upserts the tag, then the assignment on the event the ad resolves to through `resolveAdContext`.
- `lib/creative-lab/rounds.ts`: `createRound` refuses an artist with no rights document, one not approved, or one belonging to another client. Also `buildAdName`/`parseAdName`.
- `lib/creative-lab/caption-facts.ts`: `loadEventFacts` (service role) and `validateCaption`.
- `lib/creative-lab/judge.ts`: `judgeRound`, `nextRoundPlan`.
- `lib/creative-lab/load.ts`: service-role loaders for the judge and the tag writer.
- `scripts/creative-lab-judge.mts`.
- `CLAUDE.md`: the latest-migration line.

## Validation

- [x] `npm test`: 7,502 pass, 0 fail (node runner); Vitest 8/8. `lib/creative-lab`: 51 tests.
- [x] `npx tsc --noEmit`: no errors in touched files. The remaining errors are pre-existing ones in unrelated test files and in a gitignored `scripts/out/` scratch file.
- [x] ESLint on touched files: clean.
- [x] `npm run build`: passes. Locally, the gitignored `scripts/out/gds-groups.mts` fails type check, so it was moved aside for the build and then restored.

## Dry runs (prod, read-only)

### On Sale ad set `120248472059800539`, judged today (2026-11-05)

Window 2026-10-27 → 2026-11-02, insights through 2026-11-04. Event via `launched_ad_sets`. Stage `ticket_sale`, result `initiate_checkout`, 9 ads, £35.44, 7 results.

| Ad | Share | Fair | Impressions | Spend | result_metric | Results | CPR | Anchor | Verdict | Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| Luke Dean - UGC 3 | 62.6% | 11.1% | 3641 | £22.20 | initiate_checkout | 6 | £3.70 | — | thin | live from 2026-10-29, after the window starts |
| Static - Artwork | 11.1% | 11.1% | 546 | £3.93 | initiate_checkout | 0 | — | £4.50 pooled | untested | 546 impressions in the window |
| Luke Dean - UGC 2 | 6.4% | 11.1% | 347 | £2.28 | initiate_checkout | 1 | £2.28 | £5.53 pooled | untested | 347 impressions in the window |
| Enzo - UGC 1 | 5.9% | 11.1% | 327 | £2.09 | initiate_checkout | 0 | — | £4.76 pooled | untested | 327 impressions in the window |
| Enzo - UGC 3 | 5.7% | 11.1% | 304 | £2.02 | initiate_checkout | 0 | — | £4.77 pooled | untested | 304 impressions in the window |
| Luke Dean - UGC 1 | 4.8% | 11.1% | 311 | £1.71 | initiate_checkout | 0 | — | £4.82 pooled | untested | 311 impressions in the window |
| Enzo - UGC 2 | 1.8% | 11.1% | 93 | £0.65 | initiate_checkout | 0 | — | £4.97 pooled | untested | 93 impressions in the window |
| Luke Dean - UGC 4 | 0.8% | 11.1% | 30 | £0.29 | initiate_checkout | 0 | — | £5.02 pooled | untested | 30 impressions in the window |
| Enzo - UGC 4 | 0.8% | 11.1% | 51 | £0.27 | initiate_checkout | 0 | — | £5.02 pooled | untested | 51 impressions in the window |

The ad set first delivered on 29 Oct, so it has no complete window yet. The first complete one is `--on 2026-11-07` (29 Oct → 4 Nov). The data reaches 4 Nov already, so that run is shown too. There, UGC 3 is `flagged`, "funded, no CPR anchor": 62.9% share, 3,730 impressions, £22.87, 6 checkouts, £3.81 each. The other eight ads have 1 checkout between them, under the 3 a pooled anchor needs. There is also no baseline: the client's `baseline_cpr` is a cost per purchase, and a cost per purchase is not used to judge a cost per checkout.

**Correction to the review:** UGC 3 has **6** initiated checkouts, not 12. Meta reports the pixel type and the plain alias with the same value, and the review added the two together. The judge uses `firstPresentAction`, so it counts each checkout once. The unit test still uses the spec's 12-checkout shape, where the other ads have 3 checkouts and a pooled anchor exists, and there it returns `winner`.

### SIGNUP ad set `120248460768910539` (1% Lookalike — Primary, Luke Dean UGC 1–4)

The UGC 1–4 ads are in about 30 SIGNUP ad sets. This is the one with the most Luke Dean spend (£60.20). It delivered from 22 to 26 Oct, so today's window (27 Oct → 2 Nov) has nothing: the script prints "no ad delivered in the window. Last delivery: 120248460768910539 2026-10-26". The run below is `--on 2026-10-31`, whose window (22 → 28 Oct) covers the whole run. Event via `launched_ad_sets`. Stage `registration`, result `complete_registration`, 9 ads, £76.55, 16 results.

| Ad | Share | Fair | Impressions | Spend | result_metric | Results | CPR | Anchor | Verdict | Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| Luke Dean - UGC 2 | 32.6% | 11.1% | 3930 | £24.97 | complete_registration | 3 | £8.32 | £3.97 pooled | flagged | funded, cost per complete_registration over 1.5× the pooled anchor |
| Luke Dean - UGC 1 | 24.4% | 11.1% | 3137 | £18.69 | complete_registration | 5 | £3.74 | £5.26 pooled | winner | cost per complete_registration at or under the pooled anchor |
| Luke Dean - UGC 3 | 20.6% | 11.1% | 2411 | £15.76 | complete_registration | 6 | £2.63 | £6.08 pooled | winner | cost per complete_registration at or under the pooled anchor |
| Enzo - UGC 2 | 8.3% | 11.1% | 1026 | £6.35 | complete_registration | 1 | £6.35 | £4.68 pooled | — | between half and full fair share |
| Puzzle - 4th Birthday Lineup - Static | 8.1% | 11.1% | 1360 | £6.23 | complete_registration | 1 | £6.23 | £4.69 pooled | — | between half and full fair share |
| Enzo - UGC 3 | 2.5% | 11.1% | 325 | £1.94 | complete_registration | 0 | — | £4.66 pooled | untested | 325 impressions in the window |
| Enzo - UGC 4 | 1.5% | 11.1% | 196 | £1.14 | complete_registration | 0 | — | £4.71 pooled | untested | 196 impressions in the window |
| Luke Dean - UGC 4 | 1.0% | 11.1% | 151 | £0.78 | complete_registration | 0 | — | £4.74 pooled | untested | 151 impressions in the window |
| Enzo - UGC 1 | 0.9% | 11.1% | 106 | £0.69 | complete_registration | 0 | — | £4.74 pooled | untested | 106 impressions in the window |

## Notes

- **Verdict precedence:** untested → thin → loser → winner → flagged. When none applies, the verdict is null and `verdict_reason` says why. That happens between half and full fair share, or when the cost is above the anchor but within 1.5× of it.
- **Thin:** the ad went live after the window started, or insights don't reach the window's end, or the ad sets spent under £20 in the window.
- **Anchor:** the pooled cost per result of the ad's ad sets without the ad, when the rest has at least 3 results. Otherwise the client's stage `baseline_cpr` from `tag_performance`, but only when the metric is the one learning counts for that stage (registrations; purchases). Otherwise there is no cost verdict.
- **Ads in more than one event:** when a round ad's ad sets optimise for different events, its results and cost come from the ad sets sharing the event of the ad set it spent most in.
- **Artists and clients:** an artist must belong to the event's client. The validator's known names are the event's lineup, event name, venue and city. Artist records are not included.
- **`--apply`:** only with `--round`, and only for a round with status `launched` or `judged`. It writes the verdict columns and marks the round judged.
- **`event_ticket_tiers`:** it has RLS on and no user policy, so `loadEventFacts` takes a service-role client.
