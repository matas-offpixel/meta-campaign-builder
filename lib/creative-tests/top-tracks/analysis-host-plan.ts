/**
 * What scripts/top-tracks-analysis-deploy.mts creates for the Top tracks
 * analysis host, as data: names, IAM documents, the function's settings
 * and the alarms. Pure, so the least-privilege and cost rules are tested
 * (lib/creative-tests/__tests__/top-tracks-analysis-host-plan.test.ts).
 * docs/TOP_TRACKS_ANALYSIS_LAMBDA_SETUP.md explains each choice.
 */

import {
  FUNCTION_EPHEMERAL_MB,
  FUNCTION_MEMORY_MB,
  FUNCTION_RESERVED_CONCURRENCY,
  FUNCTION_TIMEOUT_SECONDS,
  MAX_AUDIO_SECONDS,
  TOP_TRACKS_ANALYSIS_FUNCTION_DEFAULT,
  TOP_TRACKS_ANALYSIS_REGION,
} from "./lambda-analysis.ts";

export const HOST = {
  region: TOP_TRACKS_ANALYSIS_REGION,
  repository: "top-tracks-analysis",
  functionName: TOP_TRACKS_ANALYSIS_FUNCTION_DEFAULT,
  roleName: "top-tracks-analysis-role",
  rolePolicyName: "top-tracks-analysis-logs",
  invokePolicyName: "top-tracks-analysis-invoke",
  logGroup: `/aws/lambda/${TOP_TRACKS_ANALYSIS_FUNCTION_DEFAULT}`,
  logRetentionDays: 14,
  topicName: "top-tracks-analysis-alarms",
  /** ECR keeps this many images; older ones expire (storage is ~$0.10/GB-month). */
  keepImages: 3,
  buildContext: "infra/top-tracks-analysis",
  platform: "linux/arm64",
  tags: { app: "meta-campaign-builder", feature: "top-tracks-analysis" },
} as const;

/** Lambda arm64 price per GB-second, eu-west-2 (the write-up's figure). */
export const ARM_GB_SECOND_USD = 0.0000133334;
export const REQUEST_USD = 0.0000002;

export function costPerCallUsd(seconds: number, memoryMb = FUNCTION_MEMORY_MB): number {
  return (memoryMb / 1024) * seconds * ARM_GB_SECOND_USD + REQUEST_USD;
}

/** The most the cap allows: every reserved slot busy all day. */
export function worstCaseDailyUsd(): number {
  return costPerCallUsd(86_400) * FUNCTION_RESERVED_CONCURRENCY;
}

export function arns(account: string) {
  const r = HOST.region;
  return {
    function: `arn:aws:lambda:${r}:${account}:function:${HOST.functionName}`,
    role: `arn:aws:iam::${account}:role/${HOST.roleName}`,
    logStreams: `arn:aws:logs:${r}:${account}:log-group:${HOST.logGroup}:*`,
    repository: `arn:aws:ecr:${r}:${account}:repository/${HOST.repository}`,
    registry: `${account}.dkr.ecr.${r}.amazonaws.com`,
    repositoryUri: `${account}.dkr.ecr.${r}.amazonaws.com/${HOST.repository}`,
  };
}

/** Only Lambda in this account assumes the execution role. */
export function trustPolicy(account: string) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: { StringEquals: { "aws:SourceAccount": account } },
      },
    ],
  };
}

/**
 * The execution role writes its own log streams and nothing else: no S3,
 * no Supabase, no network credentials (the audio comes through a signed
 * URL). The deploy script makes the log group, so the role needs no
 * CreateLogGroup. ECR pulls are granted on the repository (repositoryPolicy).
 */
export function rolePolicy(account: string) {
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "OwnLogStreams", Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: [arns(account).logStreams] }],
  };
}

/** Added to the app's IAM user (the Remotion keys): invoke this one function, beside its remotion-render-* grant. */
export function invokePolicy(account: string) {
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "InvokeTopTracksAnalysis", Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: [arns(account).function] }],
  };
}

/** Lambda may pull this repository's images for this function only. */
export function repositoryPolicy(account: string) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "LambdaPullForTopTracksAnalysis",
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
        Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
        Condition: { StringLike: { "aws:sourceArn": arns(account).function } },
      },
    ],
  };
}

export function lifecyclePolicy() {
  return {
    rules: [
      {
        rulePriority: 1,
        description: `keep the last ${HOST.keepImages} images`,
        selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: HOST.keepImages },
        action: { type: "expire" },
      },
    ],
  };
}

/**
 * The hosts the function will fetch audio from: the Supabase project's own
 * host (from NEXT_PUBLIC_SUPABASE_URL), where the Lab's copies are signed.
 */
export function audioHostsFrom(supabaseUrl: string | undefined, extra: readonly string[] = []): string[] {
  const hosts = new Set<string>();
  if (supabaseUrl) {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:") throw new Error("NEXT_PUBLIC_SUPABASE_URL is not https");
    hosts.add(u.hostname.toLowerCase());
  }
  for (const h of extra) if (h.trim()) hosts.add(h.trim().toLowerCase());
  if (hosts.size === 0) throw new Error("no audio host: set NEXT_PUBLIC_SUPABASE_URL (--env-file=.env.local) or pass --audio-hosts");
  return [...hosts].sort();
}

export type FunctionSettings = {
  Role: string;
  Architectures: ["arm64"];
  MemorySize: number;
  Timeout: number;
  EphemeralStorage: { Size: number };
  Environment: { Variables: Record<string, string> };
  Description: string;
};

export function functionSettings(account: string, audioHosts: readonly string[]): FunctionSettings {
  return {
    Role: arns(account).role,
    Architectures: ["arm64"],
    MemorySize: FUNCTION_MEMORY_MB,
    Timeout: FUNCTION_TIMEOUT_SECONDS,
    EphemeralStorage: { Size: FUNCTION_EPHEMERAL_MB },
    Environment: { Variables: { AUDIO_URL_HOSTS: audioHosts.join(","), MAX_AUDIO_SECONDS: String(MAX_AUDIO_SECONDS) } },
    Description: "Top tracks analysis (TK13/TK14/TK18): Beat This! final0 + htdemucs bass stem levels. meta-campaign-builder.",
  };
}

/** The fields of a live function's configuration that functionSettings() sets, for an idempotent update. */
export function settingsDiffer(live: Record<string, unknown>, want: FunctionSettings): string[] {
  const differ: string[] = [];
  if (live.Role !== want.Role) differ.push("Role");
  if (live.MemorySize !== want.MemorySize) differ.push("MemorySize");
  if (live.Timeout !== want.Timeout) differ.push("Timeout");
  if ((live.EphemeralStorage as { Size?: number } | undefined)?.Size !== want.EphemeralStorage.Size) differ.push("EphemeralStorage");
  if ((live.Description ?? "") !== want.Description) differ.push("Description");
  const vars = ((live.Environment as { Variables?: Record<string, string> } | undefined)?.Variables ?? {}) as Record<string, string>;
  const wantVars = want.Environment.Variables;
  if (Object.keys(vars).length !== Object.keys(wantVars).length || Object.entries(wantVars).some(([k, v]) => vars[k] !== v)) differ.push("Environment");
  return differ;
}

/**
 * Function-level alarms beside the account's billing alarms ($20 and $50,
 * which already cover every service in the account and are not changed).
 * These fire within the hour, where EstimatedCharges lags by hours.
 *
 *   compute: more than an hour of function time in an hour. Normal use is a
 *            few tracks a day (2–5 min each); a fresh act's 10 tracks are
 *            ~35 min. The cap allows 2 h an hour, so this means the cap has
 *            been mostly busy for an hour: a loop. ~$0.19 of compute.
 *   calls:   more than 150 calls in a day (~$2.40 at the dearest call).
 */
export function alarms(topicArn: string) {
  const common = {
    Namespace: "AWS/Lambda",
    Dimensions: [{ Name: "FunctionName", Value: HOST.functionName }],
    Statistic: "Sum" as const,
    EvaluationPeriods: 1,
    ComparisonOperator: "GreaterThanThreshold" as const,
    TreatMissingData: "notBreaching",
    AlarmActions: [topicArn],
    OKActions: [topicArn],
  };
  return [
    {
      ...common,
      AlarmName: `${HOST.functionName}-compute-hour`,
      AlarmDescription: "Top tracks analysis: over 1 h of function time in an hour (~$0.19 at 4 GB arm64). The cap (reserved concurrency 2) allows 2 h. Likely a loop: see docs/TOP_TRACKS_ANALYSIS_LAMBDA_SETUP.md, Roll back.",
      MetricName: "Duration",
      Period: 3600,
      Threshold: 3_600_000,
      Unit: "Milliseconds" as const,
    },
    {
      ...common,
      AlarmName: `${HOST.functionName}-calls-day`,
      AlarmDescription: "Top tracks analysis: over 150 calls in a day (normal is tens). See docs/TOP_TRACKS_ANALYSIS_LAMBDA_SETUP.md, Roll back.",
      MetricName: "Invocations",
      Period: 86_400,
      Threshold: 150,
      Unit: "Count" as const,
    },
  ];
}

export const RESERVED_CONCURRENCY = FUNCTION_RESERVED_CONCURRENCY;
