# Session log

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/preflight-enabled-adsets-only`

## Summary

The account preflight was refusing a new-campaign launch because disabled ad sets still contributed their lookalikes. It now collects only the Meta audience ids `buildMetaTargeting` would send for enabled ad sets, and names a lookalike group once. A launch 400 after a Graph POST is `source: "partial"`, not "stopped before anything was sent".

## Scope / files

- `lib/audiences/audience-account.ts` — enabled ad sets only, via `buildMetaTargeting`
- `lib/validation.ts` — foreign-account note is an error only when an enabled ad set uses the group
- `lib/meta/launch-failure-copy.ts` and `app/api/meta/launch-campaign/route.ts` — source is a field; status mapping is the fallback

## Validation

- [x] `npm run build` (TypeScript finished inside the build)
- [x] `npm test` (6630 pass, 4 skipped, vitest 5 pass)

## Notes

A 400 that follows a Graph POST in the same request is `partial`. A 400 before that POST stays `preflight`. A 502 is `meta`. An explicit `source` on the body wins over the status.
