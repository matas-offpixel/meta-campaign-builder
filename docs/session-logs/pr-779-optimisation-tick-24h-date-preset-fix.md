## PR

- **Number:** 779
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/779
- **Branch:** `cursor/optimisation-tick-24h-date-preset-fix`

## Summary

Fix task #120 PR A shadow cron producing zero decisions since Aug 7: `windowToDatePreset("24h")` returned Meta-invalid `last_1d`. Map `24h` → `yesterday`, lock the mapping against Meta's allow-list in a unit test, and Slack-notify `ads_automation` on per-campaign tick throws (24h dedupe) so this class of failure cannot stay silent again.

## Scope / files

- `lib/optimisation/live-metric.ts` — `24h` → `yesterday`; return type union updated
- `lib/optimisation/__tests__/live-metric.test.ts` — Meta allow-list guard (incident 2026-08-18)
- `lib/optimisation/__tests__/insights-fetch.test.ts` — expected presets updated
- `lib/optimisation/tick-runner.ts` — `notify` dep; fire on campaign eval throw
- `lib/optimisation/__tests__/tick-runner.test.ts` — notify contract test
- `app/api/cron/optimisation-tick/route.ts` — wire live Slack deps

## Validation

- [x] `node --test` optimisation live-metric / insights-fetch / tick-runner
- [x] `npx tsc --noEmit` (no new errors in touched optimisation files; pre-existing test-file noise elsewhere)
- [ ] `npm run build` (when applicable)

## Notes

- Root cause from live run 2026-08-18 09:29 UTC: Meta (#100) rejects `date_preset=last_1d`. Only opted-in campaign (IPC v4, rule window `24h`) threw every tick.
- Evaluator (`lib/optimisation/evaluate.ts`) intentionally untouched.
- Historical session log `pr-754-…` still mentions `last_1d` as shipped behaviour at the time — left as-is.
