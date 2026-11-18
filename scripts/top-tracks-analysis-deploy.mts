/**
 * Deploy the Top tracks analysis host: a container-image Lambda in
 * eu-west-2 next to Remotion's (Beat This! final0 + htdemucs, TK13/TK14/TK18).
 * Run by hand, by Matas. Not a build step. Idempotent: a second run changes
 * only what differs.
 *
 *   # every call it would make, with no AWS call and no credentials:
 *   node --env-file=.env.local --experimental-strip-types scripts/top-tracks-analysis-deploy.mts --dry-run
 *
 *   # the deploy (an admin profile; the Remotion keys can't create roles):
 *   AWS_PROFILE=<admin> node --env-file=.env.local --experimental-strip-types scripts/top-tracks-analysis-deploy.mts \
 *     --invoke-user <the IAM user behind REMOTION_AWS_ACCESS_KEY_ID> --alarm-email <address>
 *
 * Needs Docker (Docker Desktop or OrbStack) with buildx for the arm64 image.
 * Flags:
 *   --dry-run               print every AWS call and docker command; make none
 *   --invoke-user NAME      the IAM user the app invokes as (gets lambda:InvokeFunction on this function only);
 *                           default: read from REMOTION_AWS_ACCESS_KEY_ID with sts:GetCallerIdentity
 *   --pause                 roll back: reserved concurrency 0 (every call is refused at once); nothing else
 *   --resume                undo --pause: reserved concurrency back to the cap
 *   --alarm-email ADDR      subscribe ADDR to the alarm topic (confirm the email AWS sends)
 *   --alarm-topic-arn ARN   or use an existing eu-west-2 SNS topic instead
 *   --audio-hosts a,b       extra hosts the function may fetch audio from (the Supabase host is always in)
 *   --image-uri URI         skip the build and deploy this pushed image (repo@sha256:...)
 *   --docker BIN            docker-compatible CLI (default: docker)
 *
 * It never prints a secret: the ECR password goes to `docker login` on stdin.
 * docs/TOP_TRACKS_ANALYSIS_LAMBDA_SETUP.md is the runbook.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { FUNCTION_RESERVED_CONCURRENCY } from "../lib/creative-tests/top-tracks/lambda-analysis.ts";
import {
  HOST,
  alarms,
  arns,
  audioHostsFrom,
  costPerCallUsd,
  functionSettings,
  invokePolicy,
  lifecyclePolicy,
  repositoryPolicy,
  rolePolicy,
  settingsDiffer,
  trustPolicy,
  worstCaseDailyUsd,
} from "../lib/creative-tests/top-tracks/analysis-host-plan.ts";

const argv = process.argv.slice(2);
const has = (n: string) => argv.includes(n);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const DRY = has("--dry-run");
let invokeUser = flag("--invoke-user");
const PAUSE = has("--pause");
const RESUME = has("--resume");
const alarmEmail = flag("--alarm-email");
const alarmTopicArn = flag("--alarm-topic-arn");
const imageUriFlag = flag("--image-uri");
const dockerBin = flag("--docker") ?? "docker";

if (process.env.AWS_REGION && process.env.AWS_REGION !== HOST.region) throw new Error(`AWS_REGION is ${process.env.AWS_REGION}; this host is in ${HOST.region}`);
if (!DRY && !PAUSE && !RESUME && !alarmEmail && !alarmTopicArn) throw new Error("--alarm-email <address> or --alarm-topic-arn <arn> is required (or run --dry-run)");

const json = (v: unknown) => JSON.stringify(v);
/** A dry run prints each call's whole input; a real run shortens long ones. */
const show = (v: unknown) => {
  const s = json(v);
  return !DRY && s.length > 400 ? `${s.slice(0, 400)}…` : s;
};

/** Every AWS call goes through here: printed, and made only without --dry-run. */
async function call<T>(service: string, command: string, input: unknown, run: () => Promise<T>, dryValue?: T): Promise<T> {
  console.log(`${DRY ? "[dry-run] " : ""}${service}.${command} ${show(input)}`);
  if (DRY) return dryValue as T;
  return run();
}

function sh(cmd: string, args: string[], opts: { input?: string; quietArgs?: boolean } = {}): string {
  console.log(`${DRY ? "[dry-run] " : ""}$ ${cmd} ${args.join(" ")}${opts.input ? " (password on stdin)" : ""}`);
  if (DRY) return "";
  const out = spawnSync(cmd, args, { input: opts.input, stdio: [opts.input ? "pipe" : "ignore", "pipe", "inherit"], encoding: "utf8" });
  if (out.error) throw new Error(`${cmd}: ${out.error.message}`);
  if (out.status !== 0) throw new Error(`${cmd} ${args[0]} exited ${out.status}`);
  return out.stdout;
}

const errName = (e: unknown) => (e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "");
async function missingOn<T>(p: Promise<T>, names: string[]): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (names.includes(errName(e))) return null;
    throw e;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The SDK clients load only for a real run, so --dry-run needs no credentials.
const sdk = DRY
  ? null
  : {
      sts: await import("@aws-sdk/client-sts"),
      ecr: await import("@aws-sdk/client-ecr"),
      iam: await import("@aws-sdk/client-iam"),
      logs: await import("@aws-sdk/client-cloudwatch-logs"),
      lambda: await import("@aws-sdk/client-lambda"),
      sns: await import("@aws-sdk/client-sns"),
      cw: await import("@aws-sdk/client-cloudwatch"),
    };
const region = HOST.region;
const c = sdk && {
  sts: new sdk.sts.STSClient({ region }),
  ecr: new sdk.ecr.ECRClient({ region }),
  iam: new sdk.iam.IAMClient({ region }),
  logs: new sdk.logs.CloudWatchLogsClient({ region }),
  lambda: new sdk.lambda.LambdaClient({ region }),
  sns: new sdk.sns.SNSClient({ region }),
  cw: new sdk.cw.CloudWatchClient({ region }),
  billing: new sdk.cw.CloudWatchClient({ region: "us-east-1" }),
};

console.log(`Top tracks analysis host · ${region} · function ${HOST.functionName}${DRY ? " · DRY RUN (no AWS call is made)" : ""}`);

// Roll back / resume: the cap alone, nothing else touched.
if (PAUSE || RESUME) {
  const n = PAUSE ? 0 : FUNCTION_RESERVED_CONCURRENCY;
  await call("lambda", "PutFunctionConcurrency", { FunctionName: HOST.functionName, ReservedConcurrentExecutions: n }, () =>
    c!.lambda.send(new sdk!.lambda.PutFunctionConcurrencyCommand({ FunctionName: HOST.functionName, ReservedConcurrentExecutions: n })),
  );
  console.log(PAUSE ? "paused: every call is throttled; the app stores nothing new (throttled rows stay queued)" : `resumed: reserved concurrency ${n}`);
  process.exit(0);
}

const audioHosts = audioHostsFrom(process.env.NEXT_PUBLIC_SUPABASE_URL, (flag("--audio-hosts") ?? "").split(","));
console.log(`audio hosts: ${audioHosts.join(", ")}`);

// 0. Who and where.
const ident = await call("sts", "GetCallerIdentity", {}, () => c!.sts.send(new sdk!.sts.GetCallerIdentityCommand({})), { Account: "<account>", Arn: "<caller>" } as { Account?: string; Arn?: string });
const account = ident.Account!;
const A = arns(account);
console.log(`account ${account} as ${ident.Arn}`);

// The app's IAM user: the one behind the Remotion keys, unless named.
if (!invokeUser) {
  const keyId = process.env.REMOTION_AWS_ACCESS_KEY_ID?.trim();
  const secret = process.env.REMOTION_AWS_SECRET_ACCESS_KEY?.trim();
  const remotion = await call("sts(Remotion keys)", "GetCallerIdentity", {}, async () => {
    if (!keyId || !secret) throw new Error("--invoke-user <name>, or REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY in the env (--env-file=.env.local)");
    return new sdk!.sts.STSClient({ region, credentials: { accessKeyId: keyId, secretAccessKey: secret } }).send(new sdk!.sts.GetCallerIdentityCommand({}));
  }, { Account: "<account>", Arn: "arn:aws:iam::<account>:user/<remotion user>" } as { Account?: string; Arn?: string });
  const m = /^arn:aws:iam::(\d+|<account>):user\/(.+)$/.exec(remotion.Arn ?? "");
  if (!m) throw new Error(`the Remotion keys are not an IAM user (${remotion.Arn}); pass --invoke-user`);
  if (remotion.Account !== account) throw new Error(`the Remotion keys are in account ${remotion.Account}, the deploy is in ${account}`);
  invokeUser = m[2]!.split("/").pop()!;
  console.log(`invoke user ${invokeUser} (from the Remotion keys)`);
}

// 1. ECR repository: scan on push, immutable tags, keep the last few images, pullable by this function only.
const repo = await call("ecr", "DescribeRepositories", { repositoryNames: [HOST.repository] }, () =>
  missingOn(c!.ecr.send(new sdk!.ecr.DescribeRepositoriesCommand({ repositoryNames: [HOST.repository] })), ["RepositoryNotFoundException"]),
  null,
);
if (!repo) {
  const input = { repositoryName: HOST.repository, imageScanningConfiguration: { scanOnPush: true }, imageTagMutability: "IMMUTABLE" as const, tags: Object.entries(HOST.tags).map(([Key, Value]) => ({ Key, Value })) };
  await call("ecr", "CreateRepository", input, () => c!.ecr.send(new sdk!.ecr.CreateRepositoryCommand(input)));
} else {
  console.log(`repository ${HOST.repository} exists`);
}
await call("ecr", "PutLifecyclePolicy", { repositoryName: HOST.repository, lifecyclePolicyText: lifecyclePolicy() }, () =>
  c!.ecr.send(new sdk!.ecr.PutLifecyclePolicyCommand({ repositoryName: HOST.repository, lifecyclePolicyText: json(lifecyclePolicy()) })),
);
await call("ecr", "SetRepositoryPolicy", { repositoryName: HOST.repository, policyText: repositoryPolicy(account) }, () =>
  c!.ecr.send(new sdk!.ecr.SetRepositoryPolicyCommand({ repositoryName: HOST.repository, policyText: json(repositoryPolicy(account)) })),
);

// 2. The image: build for arm64 and push. The weights' sha256s are checked inside the build (fetch_weights.py).
let imageUri = imageUriFlag ?? "";
if (!imageUri) {
  sh(dockerBin, ["version", "--format", "{{.Server.Version}}"]);
  const auth = await call("ecr", "GetAuthorizationToken", {}, () => c!.ecr.send(new sdk!.ecr.GetAuthorizationTokenCommand({})), { authorizationData: [{ authorizationToken: "" }] } as { authorizationData?: { authorizationToken?: string }[] });
  const token = auth.authorizationData?.[0]?.authorizationToken ?? "";
  const password = DRY ? "" : Buffer.from(token, "base64").toString("utf8").split(":")[1] ?? "";
  sh(dockerBin, ["login", "--username", "AWS", "--password-stdin", A.registry], { input: DRY ? "x" : password });
  const tag = `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${(sh("git", ["rev-parse", "--short=10", "HEAD"]) || "<git sha>").trim()}`;
  const metaDir = DRY ? "<tmp>" : mkdtempSync(path.join(tmpdir(), "tt-analysis-"));
  const metaFile = path.join(metaDir, "meta.json");
  sh(dockerBin, ["buildx", "build", "--platform", HOST.platform, "--provenance=false", "--sbom=false", "--push", "--metadata-file", metaFile, "-t", `${A.repositoryUri}:${tag}`, HOST.buildContext]);
  if (DRY) {
    imageUri = `${A.repositoryUri}@sha256:<digest>`;
  } else {
    const digest = (JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, string>)["containerimage.digest"];
    rmSync(metaDir, { recursive: true, force: true });
    if (!digest?.startsWith("sha256:")) throw new Error("buildx gave no image digest");
    imageUri = `${A.repositoryUri}@${digest}`;
    // The pushed image stays in ECR; the ~2 GB local copy is removed (the build cache is kept).
    spawnSync(dockerBin, ["image", "rm", `${A.repositoryUri}:${tag}`], { stdio: "ignore" });
  }
}
console.log(`image ${imageUri}`);

// 3. Execution role: logs only.
const role = await call("iam", "GetRole", { RoleName: HOST.roleName }, () => missingOn(c!.iam.send(new sdk!.iam.GetRoleCommand({ RoleName: HOST.roleName })), ["NoSuchEntityException"]), null);
let roleIsNew = false;
if (!role) {
  const input = { RoleName: HOST.roleName, AssumeRolePolicyDocument: trustPolicy(account), Description: "Top tracks analysis Lambda: CloudWatch Logs only", Tags: Object.entries(HOST.tags).map(([Key, Value]) => ({ Key, Value })) };
  await call("iam", "CreateRole", input, () => c!.iam.send(new sdk!.iam.CreateRoleCommand({ ...input, AssumeRolePolicyDocument: json(input.AssumeRolePolicyDocument) })));
  roleIsNew = true;
} else {
  await call("iam", "UpdateAssumeRolePolicy", { RoleName: HOST.roleName, PolicyDocument: trustPolicy(account) }, () =>
    c!.iam.send(new sdk!.iam.UpdateAssumeRolePolicyCommand({ RoleName: HOST.roleName, PolicyDocument: json(trustPolicy(account)) })),
  );
}
await call("iam", "PutRolePolicy", { RoleName: HOST.roleName, PolicyName: HOST.rolePolicyName, PolicyDocument: rolePolicy(account) }, () =>
  c!.iam.send(new sdk!.iam.PutRolePolicyCommand({ RoleName: HOST.roleName, PolicyName: HOST.rolePolicyName, PolicyDocument: json(rolePolicy(account)) })),
);

// 4. Log group, made here so the role needs no CreateLogGroup.
await call("logs", "CreateLogGroup", { logGroupName: HOST.logGroup }, () =>
  missingOn(c!.logs.send(new sdk!.logs.CreateLogGroupCommand({ logGroupName: HOST.logGroup, tags: { ...HOST.tags } })), ["ResourceAlreadyExistsException"]),
);
await call("logs", "PutRetentionPolicy", { logGroupName: HOST.logGroup, retentionInDays: HOST.logRetentionDays }, () =>
  c!.logs.send(new sdk!.logs.PutRetentionPolicyCommand({ logGroupName: HOST.logGroup, retentionInDays: HOST.logRetentionDays })),
);

// 5. The function.
const want = functionSettings(account, audioHosts);
const live = await call("lambda", "GetFunction", { FunctionName: HOST.functionName }, () =>
  missingOn(c!.lambda.send(new sdk!.lambda.GetFunctionCommand({ FunctionName: HOST.functionName })), ["ResourceNotFoundException"]),
  null,
);
const waitUpdated = async () => {
  if (DRY) return;
  await sdk!.lambda.waitUntilFunctionUpdatedV2({ client: c!.lambda, maxWaitTime: 300 }, { FunctionName: HOST.functionName });
};
if (!live) {
  const input = { FunctionName: HOST.functionName, PackageType: "Image" as const, Code: { ImageUri: imageUri }, ...want, Tags: { ...HOST.tags } };
  if (roleIsNew && !DRY) await sleep(10_000); // a new role takes a few seconds to be assumable
  for (let attempt = 1; ; attempt++) {
    try {
      await call("lambda", "CreateFunction", input, () => c!.lambda.send(new sdk!.lambda.CreateFunctionCommand(input)));
      break;
    } catch (e) {
      if (attempt < 6 && errName(e) === "InvalidParameterValueException" && /assume|role/i.test(String((e as Error).message))) {
        console.log("  the new role isn't assumable yet; retrying in 10 s");
        await sleep(10_000);
        continue;
      }
      throw e;
    }
  }
  if (!DRY) await sdk!.lambda.waitUntilFunctionActiveV2({ client: c!.lambda, maxWaitTime: 600 }, { FunctionName: HOST.functionName });
} else {
  const cfg = (live.Configuration ?? {}) as Record<string, unknown>;
  const differ = settingsDiffer(cfg, want);
  if ((cfg.Architectures as string[] | undefined)?.[0] !== "arm64") throw new Error("the live function isn't arm64; delete it and run again (architecture can't change on an image function)");
  if (differ.length) {
    // Architecture is set on the code, not the configuration.
    const { Role, MemorySize, Timeout, EphemeralStorage, Environment, Description } = want;
    const update = { FunctionName: HOST.functionName, Role, MemorySize, Timeout, EphemeralStorage, Environment, Description };
    console.log(`  differs: ${differ.join(", ")}`);
    await call("lambda", "UpdateFunctionConfiguration", update, () => c!.lambda.send(new sdk!.lambda.UpdateFunctionConfigurationCommand(update)));
    await waitUpdated();
  } else {
    console.log("function settings unchanged");
  }
  const liveImage = String(live.Code?.ResolvedImageUri ?? live.Code?.ImageUri ?? "");
  const wantDigest = imageUri.split("@")[1];
  if (!wantDigest || !liveImage.endsWith(wantDigest)) {
    await call("lambda", "UpdateFunctionCode", { FunctionName: HOST.functionName, ImageUri: imageUri, Architectures: ["arm64"] }, () =>
      c!.lambda.send(new sdk!.lambda.UpdateFunctionCodeCommand({ FunctionName: HOST.functionName, ImageUri: imageUri, Architectures: ["arm64"] })),
    );
    await waitUpdated();
  } else {
    console.log("image unchanged");
  }
}

// The app only calls synchronously. Should anything call it async, Lambda doesn't retry (a retry is a second paid run).
await call("lambda", "PutFunctionEventInvokeConfig", { FunctionName: HOST.functionName, MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 }, () =>
  c!.lambda.send(new sdk!.lambda.PutFunctionEventInvokeConfigCommand({ FunctionName: HOST.functionName, MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 60 })),
);

// 6. The cap.
await call("lambda", "PutFunctionConcurrency", { FunctionName: HOST.functionName, ReservedConcurrentExecutions: FUNCTION_RESERVED_CONCURRENCY }, () =>
  c!.lambda.send(new sdk!.lambda.PutFunctionConcurrencyCommand({ FunctionName: HOST.functionName, ReservedConcurrentExecutions: FUNCTION_RESERVED_CONCURRENCY })),
);

// 7. The app's IAM user may invoke this one function.
{
  const user = invokeUser!;
  await call("iam", "GetUser", { UserName: user }, () => c!.iam.send(new sdk!.iam.GetUserCommand({ UserName: user })));
  await call("iam", "PutUserPolicy", { UserName: user, PolicyName: HOST.invokePolicyName, PolicyDocument: invokePolicy(account) }, () =>
    c!.iam.send(new sdk!.iam.PutUserPolicyCommand({ UserName: user, PolicyName: HOST.invokePolicyName, PolicyDocument: json(invokePolicy(account)) })),
  );
}

// 8. Function-level alarms, beside the account's billing alarms.
let topicArn = alarmTopicArn ?? "";
if (!topicArn) {
  const created = await call("sns", "CreateTopic", { Name: HOST.topicName }, () => c!.sns.send(new sdk!.sns.CreateTopicCommand({ Name: HOST.topicName, Tags: Object.entries(HOST.tags).map(([Key, Value]) => ({ Key, Value })) })), {
    TopicArn: `arn:aws:sns:${region}:${account}:${HOST.topicName}`,
  } as { TopicArn?: string });
  topicArn = created.TopicArn!;
}
if (alarmEmail || DRY) {
  const email = alarmEmail ?? "<alarm email>";
  const subs = await call("sns", "ListSubscriptionsByTopic", { TopicArn: topicArn }, () => c!.sns.send(new sdk!.sns.ListSubscriptionsByTopicCommand({ TopicArn: topicArn })), { Subscriptions: [] } as { Subscriptions?: { Endpoint?: string }[] });
  if (!(subs.Subscriptions ?? []).some((s) => s.Endpoint === email)) {
    await call("sns", "Subscribe", { TopicArn: topicArn, Protocol: "email", Endpoint: email }, () => c!.sns.send(new sdk!.sns.SubscribeCommand({ TopicArn: topicArn, Protocol: "email", Endpoint: email })));
    console.log("  confirm the subscription from the email AWS sends, or the alarms notify no one");
  }
}
for (const alarm of alarms(topicArn)) {
  await call("cloudwatch", "PutMetricAlarm", alarm, () => c!.cw.send(new sdk!.cw.PutMetricAlarmCommand(alarm)));
}

// 9. Read-only: the account's billing alarms (us-east-1). They stay as they are.
const billing = await call("cloudwatch(us-east-1)", "DescribeAlarmsForMetric", { Namespace: "AWS/Billing", MetricName: "EstimatedCharges" }, () =>
  c!.billing.send(new sdk!.cw.DescribeAlarmsForMetricCommand({ Namespace: "AWS/Billing", MetricName: "EstimatedCharges" })),
  { MetricAlarms: [] } as { MetricAlarms?: { AlarmName?: string; Threshold?: number; Dimensions?: { Name?: string; Value?: string }[] }[] },
);
if (!DRY) {
  const list = billing.MetricAlarms ?? [];
  if (!list.length) console.log("billing: no EstimatedCharges alarm in us-east-1. If the $20/$50 alarms are AWS Budgets, check they have no service filter.");
  for (const a of list) {
    const dims = (a.Dimensions ?? []).filter((d) => d.Name !== "Currency");
    const scope = dims.length ? dims.map((d) => `${d.Name}=${d.Value}`).join(", ") : "whole account (covers this function)";
    console.log(`billing alarm ${a.AlarmName}: > $${a.Threshold} · ${scope}`);
  }
}

console.log("");
console.log(`function ${A.function}`);
console.log(`memory ${want.MemorySize} MB · timeout ${want.Timeout} s · /tmp ${want.EphemeralStorage.Size} MB · reserved concurrency ${FUNCTION_RESERVED_CONCURRENCY} · arm64`);
console.log(`cost per call: $${costPerCallUsd(120).toFixed(4)} (2 min) – $${costPerCallUsd(300).toFixed(4)} (5 min); the cap's worst case is $${worstCaseDailyUsd().toFixed(2)}/day, and the compute alarm fires in its first hour`);
console.log("next: one test call (scripts/top-tracks-analysis-invoke.mts), then on Vercel Preview + Production:");
console.log(`  TOP_TRACKS_ANALYSIS_FUNCTION=${HOST.functionName}`);
console.log("  ENABLE_TOP_TRACKS_ANALYSIS=1   (only once PR #1342's wiring is merged)");
