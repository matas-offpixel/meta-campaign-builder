# Creative Lab M2b: caption renders on Remotion Lambda

## PR

- **Number:** 1079
- **URL:** https://github.com/matas-offpixel/meta-campaign-builder/pull/1079
- **Branch:** `cursor/creative-lab-m2b-lambda`

## Summary

Caption renders no longer run the Remotion compositor inside the Vercel function. That image has no glibc 2.35 (verified 5 Nov 2026 on Node 22.x and 26.x), so the binary does not start. `@remotion/lambda` 4.0.471 renders in `eu-west-2` and the mp4 is copied into `campaign-assets`. The Lambda cost is returned by the route and recorded here. It is not a column: migration 198 is still unapplied.

**Migration 198 is unapplied.** There is no migration 199.

## What 4.0.471 actually exports

`renderMediaOnLambdaAndStream` and `deploySiteFromBundle` are not in 4.0.471. Renders call `renderMediaOnLambda` and poll `getRenderProgress`. The deploy script calls `bundle()`, then `deploySite()`, which bundles the entry point again.

The route imports `@remotion/lambda/client` and reads the finished mp4 with the S3 client. The package root loads `@remotion/bundler`, and that rspack binding is not in the Vercel function. `downloadMedia` lives on the package root and also loads `@remotion/renderer`.

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
- `scripts/remotion-lambda-deploy.mts` and `remotion.config.ts`. The config inlines the caption font. `deploySite` only sees that override when it is passed in `options`.
- `docs/REMOTION_LAMBDA_SETUP.md`. The old filename is a banner pointing at it.
- `@remotion/lambda` pinned to `4.0.471`.

## Validation

- [x] `npm test` — 7531 node tests, 7528 pass, 0 fail, 3 skipped; vitest 8 pass
- [x] `npx tsc --noEmit` on the touched files
- [x] ESLint on the touched files
- [x] `npm run build`
- [x] Deploy script: function, bucket, serve URL, concurrency (table above)
- [x] Preview renders, after `REMOTION_LAMBDA_SERVE_URL` was set

9:16 `db1957ff-61ca-4298-b8c7-e7e799a1baa1`: `render_ms` 185237, Lambda cost $0.005 (0.00493 USD), `creative_assets` `1369f2a1-c642-4bac-98e0-697ff7417629`, 402×718.

4:5 `f5a53cc7-85fe-4660-82e5-5d18f1e5611b`: `render_ms` 165910, Lambda cost $0.004 (0.00442 USD), `creative_assets` `71210f71-93fb-415f-9a20-75fdb943e34d`, 402×502.

1080×1920 timing on `UGC Clip 1.MOV` (`videos/21a1fdcf-9fa6-4613-96de-9892d4f843b5.mov`, 45,355,904 bytes, 24.7s): did not finish. One function was still inside the TikTok Sans `delayRender` at 178s. The function limit is 240s. A split across functions hit the concurrency limit of 10 immediately. No `creative_assets` row. The S3 object was deleted.

## Notes

`render-reel` reads local `scratch/` manifests and renders with `@remotion/renderer` plus `@sparticuz/chromium`. Moving it needs more than the shared Lambda helper, so it stays. It fails on Vercel with the glibc error.

The caption font's `delayRender` timeout is 180s. Extracting the source blocks the page, and 58s was not long enough for the 6.5MB raw. The 45MB 1080p MOV still does not finish inside the 240s function.
