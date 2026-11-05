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

It calls `getOrCreateBucket`, skips `deployFunction` when a compatible function already exists, bundles `src/remotion/index.tsx`, and deploys the site as `creative-lab`. 4.0.471 has no `deploySiteFromBundle`, so `deploySite` bundles the entry point again. Function settings, when it does deploy: timeout 240s, memory 2048 MB, disk 2048 MB, CloudWatch log group on.

A concurrency quota of 10 or lower makes each caption render use one function. The script prints the quota.

`remotion.config.ts` inlines the caption font. Lambda's Chrome did not finish fetching the root-relative file. `bundle()` does not load that config, so the deploy script passes the override in `deploySite`'s `options`.

Deployed 5 Nov 2026:

| | |
|---|---|
| Bucket | `remotionlambda-euwest2-sm404lvpzi` |
| Function | `remotion-render-4-0-471-mem2048mb-disk2048mb-240sec` |
| Site | `creative-lab` |
| Serve URL | `https://remotionlambda-euwest2-sm404lvpzi.s3.eu-west-2.amazonaws.com/sites/creative-lab/index.html` |
| Concurrency | 10, so caption renders use one Lambda function |

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

Keep an alarm at $20 and a second at $50. Lambda S3 is transient: the route downloads the mp4 into `campaign-assets` and calls `deleteRender`.

## Not on Lambda

`app/api/admin/remotion/render-reel` still renders in the Vercel function with the compositor. It reads local `scratch/` manifests, so it was not moved. It fails on Vercel with the same glibc error. `next.config.ts` still traces the compositor for that route.
