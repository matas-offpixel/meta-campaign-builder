# Creative Lab M2b: caption renders on Remotion Lambda

## PR

- **Number:** pending
- **URL:** pending
- **Branch:** `cursor/creative-lab-m2b-lambda`

## Summary

Caption renders no longer run the Remotion compositor inside the Vercel function. That image has no glibc 2.35 (verified 5 Nov 2026 on Node 22.x and 26.x), so the binary does not start. `@remotion/lambda` 4.0.471 renders in `eu-west-2` and the mp4 is copied into `campaign-assets`. The Lambda cost is returned by the route and recorded here. It is not a column: migration 198 is still unapplied.

**Migration 198 is unapplied.** There is no migration 199.

## What 4.0.471 actually exports

`renderMediaOnLambdaAndStream` and `deploySiteFromBundle` are not in 4.0.471. Renders call `renderMediaOnLambda` and poll `getRenderProgress`. The deploy script calls `bundle()`, then `deploySite()`, which bundles the entry point again.

A concurrency quota of 10 or lower renders the whole clip in one function (`framesPerLambda` = the frame count, `concurrencyPerLambda` = 1). Above that, Remotion's own split is used.

Deployed 5 Nov 2026. The account quota is 10, so caption renders use one function.

| | |
|---|---|
| Bucket | `remotionlambda-euwest2-sm404lvpzi` |
| Function | `remotion-render-4-0-471-mem2048mb-disk2048mb-240sec` |
| Serve URL | `https://remotionlambda-euwest2-sm404lvpzi.s3.eu-west-2.amazonaws.com/sites/creative-lab/index.html` |
| Concurrency | 10 |

## Scope / files

- `lib/creative-lab/lambda.ts`, `lib/creative-lab/render.ts`, `lib/creative-lab/mp4-probe.ts`.
- `app/api/admin/remotion/render-caption/route.ts`: `maxDuration` 300, default memory, no Chrome. `next.config.ts` is unchanged. `render-reel` still uses the compositor and is broken on Vercel for the same glibc reason.
- `scripts/remotion-lambda-deploy.mts`.
- `docs/REMOTION_LAMBDA_SETUP.md`. The old filename is a banner pointing at it.
- `@remotion/lambda` pinned to `4.0.471`.

## Validation

- [x] `npm test` — 7531 node tests, 7528 pass, 0 fail, 3 skipped; vitest 8 pass
- [x] `npx tsc --noEmit` on the touched files
- [x] ESLint on the touched files
- [x] `npm run build`
- [x] Deploy script: function, bucket, serve URL, concurrency (table above)
- [ ] Preview renders of the two rows, and the 1080 timing sample, after `REMOTION_LAMBDA_SERVE_URL` is set

## Notes

`render-reel` reads local `scratch/` manifests and renders with `@remotion/renderer` plus `@sparticuz/chromium`. Moving it needs more than the shared Lambda helper, so it stays. It fails on Vercel with the glibc error.
