# Session log

## PR

- **Number:** 716
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/716
- **Branch:** `cursor/d2c-bird-journey-automation-definition`

## Summary

PR C of the Bird Journey automation arc (see `docs/D2C_BIRD_JOURNEY_PR_OUTLINE_PROVISIONAL.md`
§1/§3). Adds `lib/d2c/bird/journeys/definition.ts` — pure functions building
the journey `trigger` shape (`buildContactAddedToGroupTrigger`) and version
`definition` step graph (`buildAutorespJourneyDefinition`), plus a
composition helper (`resolveAutorespJourneyDefinition`) that reuses the
already-shipped `resolveBirdTemplateInfo` (`lib/d2c/bird/provider.ts`) and
`resolveBirdTemplateVariables` (`lib/d2c/bird/template-variables.ts`) — no
new variable logic or template-identity resolution rule. No
`JOURNEY_CREATE_VERIFIED` gate needed: these are pure functions with zero
network calls; it's the *shape* that's confirmed here (byte-exact against a
live published-journey read), independent of whether the write-call sequence
to persist it is confirmed (that's `writeJourneyVersion` in PR A, still TBD).

## Scope / files

- `lib/d2c/bird/journeys/definition.ts` (new)
- `lib/d2c/bird/journeys/__tests__/definition.test.ts` (new)

## Validation

- [x] `npm test` (`node --experimental-strip-types --test 'lib/d2c/bird/journeys/__tests__/definition.test.ts'`) — 7/7 pass
- [x] Byte-diff test: the send step's `parameters` are asserted deep-equal
  against `.scratch/bird-journey-version-detail.json` (`C26-Barcelona`, live
  published journey, 2026-07-09) — including fields the original outline's
  candidate omitted (`flowTaskExtension`, `ignoreQuietHours`,
  `meta.pushNotifications`). Step-id suffixes are Bird-generated per-write
  (not a stable convention), so the test follows `startAt`/`next` references
  rather than hardcoding ids.
- [x] Trigger shape byte-diff against the same live-read convention (every
  enumerated journey shares the identical `journey-contact` /
  `contact-added-to-group` shape, differing only in `groupId`)
- [x] Composition tests cover: primary `audience.project_id`/`template_id`
  path, `bird_template_project_id`/`_version_id` fallback (Bug B path), and
  the `null` no-template-configured case
- [x] Purity test (same input -> same output, deterministic)
- [x] Full `lib/**/__tests__/*.test.ts` — 3062/3076; same 14 pre-existing
  failures as PR A/B's baseline, zero new failures
- [x] `npx eslint lib/d2c/bird/journeys` — clean

## Notes

- Self-merging per Matas's explicit rollout instruction ("Pure function, unit
  tests only... Self-merge on green").
- All three scaffolding PRs (A: client, B: group resolver, C: definition
  builder) are now merged. Per Matas's HOLD list, next steps (arm/disarm
  wiring §4, 3-of-3 gate + `FEATURE_D2C_BIRD_JOURNEY` flag §5, poll-cron
  subtractive dedup §6) wait for the DevTools capture to byte-confirm
  `writeJourneyVersion`/`publishVersion` and flip `JOURNEY_CREATE_VERIFIED`.
