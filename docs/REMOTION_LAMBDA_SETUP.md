# Remotion Lambda

**Date:** 5 Nov 2026
**Region:** `eu-west-2`
**Package:** `@remotion/lambda` 4.0.471, the same version as `@remotion/renderer`

Caption renders run here because the Vercel function image has no glibc 2.35. `@remotion/compositor-linux-x64-gnu` does not start on Node 22.x or 26.x (the `>=22` engines range selects 26.x and overrides the project setting of 24.x, so 24.x did not run). Checked 5 Nov 2026.

The June runbook (`docs/REMOTION_AWS_SETUP_SUPERSEDED_2026-06-04.md`) pointed at an in-process Vercel render. That file is now a banner pointing here.

## What is set

Vercel Preview and Production:

```
REMOTION_AWS_ACCESS_KEY_ID
REMOTION_AWS_SECRET_ACCESS_KEY
REMOTION_AWS_REGION=eu-west-2
REMOTION_LAMBDA_SERVE_URL
```

The three `REMOTION_AWS_*` values are already on Preview and Production. `REMOTION_LAMBDA_SERVE_URL` is the serve URL in the table below. The route errors before any AWS call when it is unset. Set it on Preview and Production before the next deploy.

The IAM role is `remotion-lambda-role`, with the role policy named `remotion-lambda-policy`. The user policy is inline. Both JSON documents are the 4.0.471 output of `remotion lambda policies role` and `remotion lambda policies user`.

Deploy, by hand, when the composition changes. It is not a build step:

```bash
node --env-file=.env.local --experimental-strip-types scripts/remotion-lambda-deploy.mts
```

It calls `getOrCreateBucket`, skips `deployFunction` when a compatible function already exists, bundles `src/remotion/index.tsx`, and deploys the site as `creative-lab`. 4.0.471 has no `deploySiteFromBundle`, so `deploySite` bundles the entry point again. Function settings, when it does deploy: timeout 480s, memory 2048 MB, disk 2048 MB, CloudWatch log group on. A function deployed at 240s is not reused; the name gains `480sec` and `REMOTION_LAMBDA_SERVE_URL` stays the same site.

A concurrency quota of 10 or lower makes each caption render use one function. Above that the fan-out below applies. The script prints the quota and the fan-out.

`remotion.config.ts` inlines the caption font. Lambda's Chrome did not finish fetching the root-relative file. `bundle()` does not load that config, so the deploy script passes the override in `deploySite`'s `options`.

Deployed 6 Nov 2026. Redeployed from `main` (8438049) on 9 Nov 2026, the same `creative-lab` site and serve URL: the 6 Nov site had no `FrameSheet` composition (added 7 Nov, #1111), so every burned-in text check stored check by eye, and its caption profile was older than main's. After the redeploy the bundle's caption `styleVersion` is `4a9ddd841764b7a5296f522081afc7af816fd6dabc87a0c869f43c55f94e69e5` and quote is `e50f3de2…`. Redeploy whenever `src/remotion/` changes. The 240s function from 5 Nov is still in the account. Renders select the 480s function by timeout, so nothing should point at the old one. The serve URL did not change.

| | |
|---|---|
| Bucket | `remotionlambda-euwest2-sm404lvpzi` |
| Function | `remotion-render-4-0-471-mem2048mb-disk2048mb-480sec` |
| Site | `creative-lab` |
| Serve URL | `https://remotionlambda-euwest2-sm404lvpzi.s3.eu-west-2.amazonaws.com/sites/creative-lab/index.html` |
| Concurrency | 1000 (AWS approved the increase from 10; read 9 and 10 Nov 2026). See Fan-out |

## Fan-out

AWS approved 1000 concurrent Lambda executions in `eu-west-2`, up from 10. At 10 a caption render used one function. At 1000 `renderMediaOnLambda` splits a render into chunks, one function per chunk, plus one function that runs the render. `lib/creative-lab/lambda.ts` sets the split. It does not leave it to Remotion's default.

| Value | Set to | Why |
|---|---|---|
| `MAX_FUNCTIONS_PER_CAPTION_RENDER` | 20 | 20 functions rendered the 26 s clip in 30 s for $0.0126. Remotion's default used 33 functions (24 s, $0.0150). 11 functions took 52 s for $0.0117. |
| `MIN_FRAMES_PER_LAMBDA` | 20 | Remotion's own minimum. A 2 s clip stays on 3 functions. |
| `MAX_LAB_RENDERS_AT_ONCE` | 4 | 4 renders × 21 functions is 84, 8% of the quota. Four at once each took 31–36 s, against 30 s for one alone. A default 8-ad round renders in two ticks instead of eight. |

`framesPerLambda` is the larger of 20 and frames ÷ 20, rounded up. So a render uses at most 20 functions: a 30 s clip at 30 fps is 45 frames each, a 2 s clip is 20 frames each. `/api/cron/creative-lab-render-tick` claims only the slots that renders already in flight leave free, and runs its claims side by side. A frame-sheet still (`FrameSheet`, the burned-in text check) is one `renderStillOnLambda` call and one function at any quota.

Measured 10 Nov 2026 on clip 2 of the Luke Dean press kit (`Luke dean1.mp4`, 1080×1920, 25 fps, 26.1 s), function `…-480sec`, site `creative-lab` as redeployed on 9 Nov. Times are wall clock from the start call to done. Costs are Remotion's estimates. Each S3 render was deleted. No database row was written.

| Render | Before (Remotion default) | After (this split) |
|---|---|---|
| `CaptionOnClip`, 2 s (50 frames) | 20.1 s, $0.00112, 3 functions + 1 | 16.8 s, $0.00102, 3 functions + 1 |
| `CaptionOnClip`, whole clip, 26 s (653 frames) | 24.5 s, $0.0150, 33 functions + 1 | 30.2 s, $0.0126, 20 functions + 1 |
| `CaptionOnClip`, 26 s, four at once | — | 31.2–35.5 s each, $0.0130–0.0137 each, 20 + 1 each, 84 in all |
| `FrameSheet` still | 6.5 s, $0.00018, 1 function | 7.3 s, $0.00020, 1 function |

Both 2 s renders used 3 chunks (17 and 20 frames each), so the 3 s between them is not the split.

## Role policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "0",
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets"],
      "Resource": ["*"]
    },
    {
      "Sid": "1",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:ListBucket",
        "s3:PutBucketAcl",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:PutObjectAcl",
        "s3:PutObject",
        "s3:GetBucketLocation"
      ],
      "Resource": ["arn:aws:s3:::remotionlambda-*"]
    },
    {
      "Sid": "2",
      "Effect": "Allow",
      "Action": ["lambda:InvokeFunction"],
      "Resource": ["arn:aws:lambda:*:*:function:remotion-render-*"]
    },
    {
      "Sid": "3",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup"],
      "Resource": ["arn:aws:logs:*:*:log-group:/aws/lambda-insights"]
    },
    {
      "Sid": "4",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/aws/lambda/remotion-render-*",
        "arn:aws:logs:*:*:log-group:/aws/lambda-insights:*"
      ]
    }
  ]
}
```

## User policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "HandleQuotas",
      "Effect": "Allow",
      "Action": [
        "servicequotas:GetServiceQuota",
        "servicequotas:GetAWSDefaultServiceQuota",
        "servicequotas:RequestServiceQuotaIncrease",
        "servicequotas:ListRequestedServiceQuotaChangeHistoryByQuota"
      ],
      "Resource": ["*"]
    },
    {
      "Sid": "PermissionValidation",
      "Effect": "Allow",
      "Action": ["iam:SimulatePrincipalPolicy"],
      "Resource": ["*"]
    },
    {
      "Sid": "LambdaInvokation",
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": ["arn:aws:iam::*:role/remotion-lambda-role"]
    },
    {
      "Sid": "Storage",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:PutObjectAcl",
        "s3:PutObject",
        "s3:CreateBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:PutBucketAcl",
        "s3:DeleteBucket",
        "s3:PutBucketOwnershipControls",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketPolicy",
        "s3:PutLifecycleConfiguration"
      ],
      "Resource": ["arn:aws:s3:::remotionlambda-*"]
    },
    {
      "Sid": "BucketListing",
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets"],
      "Resource": ["*"]
    },
    {
      "Sid": "FunctionListing",
      "Effect": "Allow",
      "Action": ["lambda:ListFunctions", "lambda:GetFunction"],
      "Resource": ["*"]
    },
    {
      "Sid": "FunctionManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeAsync",
        "lambda:InvokeFunction",
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:PutFunctionEventInvokeConfig",
        "lambda:PutRuntimeManagementConfig",
        "lambda:TagResource"
      ],
      "Resource": ["arn:aws:lambda:*:*:function:remotion-render-*"]
    },
    {
      "Sid": "LogsRetention",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:PutRetentionPolicy"],
      "Resource": ["arn:aws:logs:*:*:log-group:/aws/lambda/remotion-render-*"]
    },
    {
      "Sid": "FetchBinaries",
      "Effect": "Allow",
      "Action": ["lambda:GetLayerVersion"],
      "Resource": [
        "arn:aws:lambda:*:678892195805:layer:remotion-binaries-*",
        "arn:aws:lambda:*:580247275435:layer:LambdaInsightsExtension*"
      ]
    }
  ]
}
```

## Billing

Keep an alarm at $20 and a second at $50. The alarms must stay in place at the 1000 quota: a render loop can now run 84 functions at once instead of 10. Do not remove them. Lambda S3 is transient: the route downloads the mp4 into `campaign-assets` and calls `deleteRender`.

## Not on Lambda

`app/api/admin/remotion/render-reel` still renders in the Vercel function with the compositor. It reads local `scratch/` manifests, so it was not moved. It fails on Vercel with the same glibc error. `next.config.ts` still traces the compositor for that route.
