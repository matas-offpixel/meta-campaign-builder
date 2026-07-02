# Session log — D2C direct-fire capture-driven follow-up (layers 6+9)

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `d2c/direct-fire-live-fix-followup`

## Summary

Follow-up to PR #661. The runtime-send capture (`.scratch/bird-runtime-send-capture.txt`)
landed — sourced from Bird's public API docs after a real DevTools capture
proved unobtainable (Bird's UI test-send flow doesn't surface the payload in
the Network panel). Reconciled `lib/d2c/bird/provider.ts` against it: fixed
the layer 6 receiver-array bug and the layer 9 template-body shape (top-level
`template` keyed by `projectId`/`version`, flat `parameters[]`, no `body`
field on template sends). Flipped `BIRD_RUNTIME_SEND_VERIFIED = true`. Filled
the 3 previously-skipped byte-diff tests. Updated the runbook with a "how the
verified path was built" section documenting provenance and the one residual
risk (list_id receiver shape isn't docs-covered).

## Scope / files

- `lib/d2c/bird/provider.ts` — receiver array fix, top-level template shape, flag flip
- `lib/d2c/bird/__tests__/provider.test.ts` — fixture field rename + verified-shape assertions
- `lib/d2c/bird/__tests__/provider.integration.test.ts` — 3 byte-diff tests filled in against capture
- `docs/D2C_LIVE_FIRE_RUNBOOK.md` — layers 6+9 marked fixed, new "how the verified path was built" section

## Validation

- [x] `npx tsc --noEmit` — clean on changed files
- [x] `npm run build` — clean
- [x] `npm test` (d2c suite) — 95 pass, 0 fail, 1 skipped (pre-existing, unrelated)
- [x] `eslint` changed files — 0 errors

## Notes

- **Pre-code DB check:** queried the actual smoke-test row
  (`e22b99c5-eabd-459f-a980-85684056b450`) before writing any code. It has
  `variables: {}` and `audience: { list_id }` with no `brand`/`event_code` —
  confirms it routes through the generic `provider.send()` path (this PR's
  scope), not the still-stubbed `executeBirdJob` orchestration path. Its
  linked `d2c_templates` row is plain markdown (no `project_id`/`template_id`),
  so the actual smoke-test send goes out as plain text, not a template
  message — meaning the smoke test mainly exercises the layer-6 list_id fix.
- **Judgment call flagged loudly:** the "capture" is docs-derived, not an
  actual DevTools capture (documented in the file itself). Flipped
  `BIRD_RUNTIME_SEND_VERIFIED = true` per the explicit brief, with the
  `list_id` receiver shape called out as the one residual guess (Bird's docs
  only cover phone-identifier receivers) — the post-merge smoke test is the
  live-fire check for that specific piece, with a documented fallback chain
  in the runbook if it 422s.
- `executeBirdJob` (orchestration-path executor) remains an unconditional stub
  — out of scope for both this PR and #661, which explicitly left the
  cron/executor untouched.
