> ⚠️ **SUPERSEDED 2026-06-04.** Output spec changed to ≤30s stills/video. Vercel function limit covers render time with 10× headroom. AWS Lambda + S3 + IAM provisioning is no longer required.
>
> **Canonical path:** in-process render on Vercel via `@remotion/renderer` — shipped in PR #531 (commit b365910). Live source-of-truth: `docs/cursor-prompts/REMOTION_WEEK1_POC_VERCEL_2026-06-04.md`.
>
> Kept for history. Do not action.

# Remotion Lambda — AWS provisioning runbook

**Date:** 2026-06-04
**Owner:** Matas (or Sarah-paired, ~30-60 min)
**Prerequisite for:** Cursor Week 1 POC (`lib/creatives/remotion/`)
**Cost expectation:** <$20/mo at projected volume (see scope doc section 5)

This is the AWS-side setup that has to happen before the Cursor build can run. Remotion is a React library that renders video; Remotion Lambda is AWS Lambda functions Remotion deploys to do the rendering work in the cloud. We hand it a composition + inputs, it returns an S3 URL.

## What gets created

1. **AWS account** (if not already) — or use existing Off Pixel AWS if one exists.
2. **IAM user** with programmatic-only access — `offpixel-remotion-deploy`.
3. **S3 bucket** for Remotion's render output — auto-created by Remotion CLI, default name `remotionlambda-<region>-<hash>`.
4. **Lambda function** Remotion deploys — auto-named by Remotion CLI based on version.
5. **Vercel env vars** to give the Next.js app access.

## Step-by-step

### 1. AWS account check

Open AWS Console — confirm you can sign in. If no Off Pixel AWS exists yet:
- Create one at `aws.amazon.com` with `accounts@offpixel.co.uk` (or whichever finance address you use).
- Set up billing alerts at $20 and $50 immediately — this is a small bill but a runaway render loop could spike.

### 2. Create IAM user `offpixel-remotion-deploy`

In IAM Console:
- Users → Add users → name: `offpixel-remotion-deploy`
- Access type: **Programmatic access** only (no console login).
- Permissions: attach the Remotion Lambda policy directly. Remotion's docs give you the exact JSON. The short version: the user needs permissions for `lambda:*`, `s3:*` (scoped to remotionlambda-* buckets), `iam:PassRole` (for the Lambda exec role), `cloudwatch:*` (for logs).
- Source the exact policy from: https://www.remotion.dev/docs/lambda/setup#3-create-an-iam-user (don't paste a stale version — Remotion updates it).
- **Save the Access Key ID + Secret Access Key.** They're shown once.

### 3. Install Remotion CLI locally

```bash
npm install --save-exact @remotion/cli @remotion/lambda
```

(Adds to `package.json` — commits in the same PR as the provider code.)

### 4. Configure AWS credentials locally

In your shell, add to `~/.aws/credentials`:

```
[offpixel-remotion]
aws_access_key_id = <Access Key ID from step 2>
aws_secret_access_key = <Secret Access Key from step 2>
```

Set the active profile:

```bash
export AWS_PROFILE=offpixel-remotion
export AWS_REGION=eu-west-1
```

(`eu-west-1` = Ireland. Closest to UK for latency. Lambda pricing is the same.)

### 5. Deploy the Lambda function

From the repo root:

```bash
npx remotion lambda functions deploy
```

Output will name the function (e.g. `remotion-render-4-0-XXX-mem2048mb-disk2048mb-120sec`). Save this name — it goes into the env vars.

### 6. Deploy the S3 site

Remotion needs the bundled composition code in S3 to render it. From the repo root, once the first composition exists:

```bash
npx remotion lambda sites create src/remotion/index.ts --site-name=offpixel-renders
```

Returns the serve URL (e.g. `https://remotionlambda-eu-west-1-xxx.s3.eu-west-1.amazonaws.com/sites/offpixel-renders/index.html`). This URL goes into the env vars too.

**This step is run by Cursor in the build PR, not in this runbook** — but the IAM user needs the permissions to do it. Step 2 covers that.

### 7. Vercel env vars

Add to **Production + Preview** environments on Vercel (not Development — local dev uses `.env.local`):

```
REMOTION_AWS_ACCESS_KEY_ID=<from step 2>
REMOTION_AWS_SECRET_ACCESS_KEY=<from step 2>
REMOTION_AWS_REGION=eu-west-1
REMOTION_LAMBDA_FUNCTION_NAME=<from step 5>
REMOTION_LAMBDA_SERVE_URL=<from step 6 — added later by Cursor>
REMOTION_S3_BUCKET=<auto-detected from function — Cursor PR will document>
FEATURE_REMOTION=0
```

**Keep `FEATURE_REMOTION=0` until Cursor Week 1 POC validates.** Flag flips to `1` only after the POC's validation gate passes (render <60s, Meta upload works, ad runs PAUSED).

### 8. Local `.env.local` for Cursor dev

Same set as step 7. Cursor needs these to test renders against Lambda from local dev.

## Verification checklist

After steps 1-7:

- [ ] IAM user shows in AWS Console under Users → `offpixel-remotion-deploy`.
- [ ] `aws sts get-caller-identity --profile offpixel-remotion` returns the user ARN.
- [ ] `npx remotion lambda functions ls` lists the deployed function.
- [ ] Vercel env vars present in Production + Preview (check Settings → Environment Variables).
- [ ] Billing alerts configured at $20 + $50.
- [ ] `FEATURE_REMOTION=0` everywhere — confirm before merging the Cursor PR.

## Cost ceiling

Per the scope doc, projected volume is ~600-900 renders/month at ~10s each. At Lambda pricing of ~$0.001/sec that's $6-9/mo. S3 storage is negligible (the renders go to Supabase Storage shortly after — Lambda S3 is transient).

**Billing alarm should hold at $20/mo.** Anything over that = either a render-loop bug or volume growth that needs revisiting the self-host decision.

## What can go wrong

1. **IAM policy too narrow.** Remotion's CLI errors with "AccessDenied" — go back to step 2 and re-paste from Remotion's docs.
2. **Region mismatch.** Lambda + S3 + serve URL must all be in the same region. `eu-west-1` everywhere.
3. **Lambda memory/disk size.** Default is 2GB RAM + 2GB disk. Fine for 1080×1080 statics. For 1080×1920 vertical motion at higher quality, may need to redeploy at 4GB RAM. Re-running `functions deploy` with `--memorySizeInMb=4096 --diskSizeInMb=4096` creates a new function — leave the old one running while testing the new one.
4. **Cold-start latency.** First render of the day takes 30-45s. Acceptable for now; Remotion's `warmup` flag fixes it if needed.

## Hand-off

Once steps 1-7 are done, the Cursor prompt (separate doc) can start. Cursor's PR will:
- Add `lib/creatives/remotion/provider.ts` against the existing `CreativeProvider` interface
- Add `remotion` to the registry in `lib/creatives/registry.ts`
- Add a TSX composition under `src/remotion/`
- Wire `/admin/render-test` for hardcoded trigger
- Set up the S3 site deploy step (step 6) as part of the build

Cursor cannot do steps 1-5 itself — they require AWS Console + local AWS CLI access. Those are yours.
