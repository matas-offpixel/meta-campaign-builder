# Cursor prompt: Creative Lab M2b, Remotion Lambda render path (2026-11-05)

Why: Vercel's function images (Node 22/24/26) lack glibc 2.35, which the Remotion 4.0.471 compositor needs, so `renderMedia` can't run there (#1078). AWS is set up: account OFF PIXEL LTD, IAM policy `remotion-lambda-policy`, role `remotion-lambda-role`, user `remotion-user` with `remotion-user-policy`, access key in Vercel as `REMOTION_AWS_ACCESS_KEY_ID` / `REMOTION_AWS_SECRET_ACCESS_KEY` / `REMOTION_AWS_REGION=eu-west-2` (Production + Preview). Budget alerts at $20 and $50.

```
[Use Opus] BUILD Creative Lab M2b: move caption rendering to Remotion Lambda.

Branch cursor/creative-lab-m2b-lambda off fresh main. Check `gh pr list --search "lambda"` first. One PR. Read docs/session-logs/creative-lab-roadmap-2026-11-05.md (M2), lib/creative-lab/render.ts, app/api/admin/remotion/render-caption/route.ts, docs/REMOTION_AWS_SETUP_SUPERSEDED_2026-06-04.md and Remotion's Lambda setup page (remotion.dev/docs/lambda/setup) before starting.

=== CREDENTIALS ===
Run `vercel env pull .env.local` so REMOTION_AWS_* are available locally (approved). Never print, log or commit them; .env.local is gitignored. If the pull fails, stop and say so.

=== DEPENDENCY ===
Add @remotion/lambda pinned to exactly 4.0.471 (must match @remotion/renderer; approved package.json change). No other new deps.

=== DEPLOY SCRIPT ===
scripts/remotion-lambda-deploy.mts (run by hand when the composition changes; not a build step):
- getOrCreateBucket + deployFunction({ region: eu-west-2, timeoutInSeconds: 240, memorySizeInMb: 2048, diskSizeInMb: 2048, createCloudWatchLogGroup: true }) — skip if a compatible function exists (getFunctions compatibleOnly).
- bundle(src/remotion/index.tsx) → deploySiteFromBundle({ siteName: 'creative-lab' }); print the serve URL.
- Print `npx remotion lambda quotas`-equivalent via the API (getAwsQuotas / estimatePrice helpers as available); report the concurrency limit.
- Idempotent; prints names and URLs only.

=== RENDER PATH ===
lib/creative-lab/render.ts: replace renderMedia with renderMediaOnLambdaAndStream (or renderMediaOnLambda + getRenderProgress if streaming isn't available in 4.0.471; say which):
- functionName from getFunctions({ region, compatibleOnly: true }); serveUrl from env REMOTION_LAMBDA_SERVE_URL (document it; Matas sets it from the deploy script output) with a clear error when unset.
- inputProps as today; clipUrl is a short-lived Supabase signed URL (60 min).
- codec h264, privacy 'private', framesPerLambda default; if the account quota is 10, set concurrencyPerLambda/framesPerLambda for single-function rendering and say so.
- On completion: downloadMedia to /tmp → upsertRegisteredAsset into campaign-assets → creative_assets row (sha256, aspect, duration_seconds) → update creative_lab_renders (status, render_ms, creative_asset_id, and the Lambda cost estimate in a new column if you add one via migration 199, else in the session log only) → deleteRender on S3 so nothing accumulates.
- Errors: Lambda failure → render row 'failed' with the first error message; no retry loop.
- The route app/api/admin/remotion/render-caption no longer needs Chrome, the compositor or the 600 s / 3 GB config: drop to maxDuration 300, default memory, and remove its next.config.ts dependency note. Do NOT edit next.config.ts (the outputFileTracingIncludes stays for render-reel).
- render-reel: migrate to the same Lambda helper only if it is a contained change (one route file + shared helper); otherwise leave it and note it in the PR as broken on Vercel.

=== DOCS ===
- CLAUDE.md: add REMOTION_AWS_ACCESS_KEY_ID, REMOTION_AWS_SECRET_ACCESS_KEY, REMOTION_AWS_REGION, REMOTION_LAMBDA_SERVE_URL to the env list with one paragraph (why Lambda, the deploy script, the glibc reason, budget alerts).
- Un-supersede docs/REMOTION_AWS_SETUP_SUPERSEDED_2026-06-04.md: rename to docs/REMOTION_LAMBDA_SETUP.md, update it to what was actually done on 5 Nov 2026 (names above, eu-west-2, the two JSON policies), and point the old filename's banner at it.

=== TESTS ===
- render.ts with the fake db and a stubbed Lambda client: success path writes creative_assets + render row and calls deleteRender; failure path marks failed; missing serve URL errors before any AWS call.

=== VERIFY ===
npm test, tsc --noEmit and ESLint on touched files, npm run build.
Run the deploy script; paste function name, bucket, serve URL and the concurrency quota (no keys). Tell Matas the serve URL to add to Vercel as REMOTION_LAMBDA_SERVE_URL, then wait for his "added" before the next step.
Then on the Vercel preview: reset the two creative_lab_renders rows (9:16 db1957ff-61ca-4298-b8c7-e7e799a1baa1, 4:5 f5a53cc7-85fe-4660-82e5-5d18f1e5611b) to queued and render both through the route. Paste render_ms, the Lambda cost estimate and the creative_assets ids. Time one 1080×1920 render on "UGC Clip 1.MOV" (24.7 s) for the feasibility number; delete that output and its S3 object.
Push once. Report SHA, PR, `git log origin/<branch> --oneline -3`. Stop.
```
