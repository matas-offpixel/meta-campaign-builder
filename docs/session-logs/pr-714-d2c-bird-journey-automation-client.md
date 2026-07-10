# Session log

## PR

- **Number:** 714
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/714
- **Branch:** `cursor/d2c-bird-journey-automation-client`

## Summary

PR A of the Bird Journey automation arc (see `docs/D2C_BIRD_JOURNEY_PR_OUTLINE_PROVISIONAL.md`,
`docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md`). Adds
`lib/d2c/bird/journeys/client.ts`, a typed client for Bird's Journey
automation API. Only `createJourneyShell` (and read helpers: `listJourneys`,
`getJourney`, `findJourneyByName`, `listJourneyVersions`, `deleteJourney`) are
live/callable — all CONFIRMED against controlled probes (2026-07-09/10).
`writeJourneyVersion` and `publishVersion` are dead code: gated by
`JOURNEY_CREATE_VERIFIED = false`, which throws
`BIRD_JOURNEY_SEQUENCE_UNCONFIRMED` before ever reaching the network. Nothing
in this PR is wired into any live code path (no callers exist yet — arm/disarm
wiring is PR D+, held per Matas's explicit instruction until the full sequence
is byte-confirmed via DevTools capture).

## Scope / files

- `lib/d2c/bird/journeys/client.ts` (new)
- `lib/d2c/bird/journeys/__tests__/client.test.ts` (new)
- `docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md`,
  `docs/D2C_BIRD_JOURNEY_PR_OUTLINE_PROVISIONAL.md` (folded in the read-only
  corroboration finding from 2026-07-10 — trigger lives on the version object,
  not the journey envelope; probe #2 cleanup)

## Validation

- [x] `npx tsc --noEmit` (n/a — repo has no standalone tsc script; relies on `next build` type-checking, not run for this isolated-module PR; ESLint + `node --test` both clean)
- [ ] `npm run build` (when applicable) — not run; no app-layer wiring in this PR
- [x] `npm test` (`node --experimental-strip-types --test 'lib/d2c/bird/journeys/__tests__/*.test.ts'`) — 12/12 pass
- [x] Full `lib/**/__tests__/*.test.ts` suite — 3047/3061 pass pre-existing baseline (14 pre-existing failures, all in unrelated `lib/dashboard`, `lib/db`, `lib/meta` files — none touch `lib/d2c/bird/**`)
- [x] `npx eslint lib/d2c/bird/journeys` — clean

## Notes

- Byte-diff test (`createJourneyShell: request body is byte-exact against the
  captured probe #2 POST`) pins the exact request/response captured in
  `.scratch/bird-journey-create-probe-capture.txt` (probe #2,
  2026-07-10T07:22:54.919Z) so any future accidental change to the CONFIRMED
  shape fails loudly.
- `writeJourneyVersion` / `publishVersion` bodies are intentionally
  speculative (candidate verbs/shapes, commented as such) — they exist so the
  eventual byte-confirmed swap-in is a small diff, not a new file. Both have
  explicit tests asserting they throw `BIRD_JOURNEY_SEQUENCE_UNCONFIRMED`
  *before* touching the network (asserted via `calls.length === 0` on a
  mocked fetch).
- Self-merging per Matas's explicit rollout instruction ("Self-merge on green
  tests") — no live-behaviour change, nothing calls into this module yet.
- Next: PR B (group/list resolver consolidation), PR C (definition builder).
  Both follow this same branch-per-PR pattern per thread-boundaries.mdc.
