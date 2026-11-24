/**
 * What the Top tracks analysis host's deploy script creates: least-privilege
 * IAM, the function's settings (4096 MB, 600 s, arm64, cap 2), the alarms
 * beside the billing alarms, and the cost per call the write-up gives.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HOST,
  alarms,
  arns,
  audioHostsFrom,
  costPerCallUsd,
  functionSettings,
  invokePolicy,
  repositoryPolicy,
  rolePolicy,
  settingsDiffer,
  trustPolicy,
  worstCaseDailyUsd,
} from "../top-tracks/analysis-host-plan.ts";
import { FUNCTION_RESERVED_CONCURRENCY, FUNCTION_TIMEOUT_SECONDS, MAX_AUDIO_SECONDS } from "../top-tracks/lambda-analysis.ts";

const ACCOUNT = "123456789012";
const HOSTS = ["abcdefghijkl.supabase.co"];

type Statement = { Effect: string; Action: string | string[]; Resource?: string[]; Principal?: unknown; Condition?: unknown };
const statements = (doc: { Statement: Statement[] }) => doc.Statement;

describe("IAM, least privilege", () => {
  it("the execution role writes its own log streams and nothing else", () => {
    const s = statements(rolePolicy(ACCOUNT));
    assert.equal(s.length, 1);
    assert.deepEqual(s[0]!.Action, ["logs:CreateLogStream", "logs:PutLogEvents"]);
    assert.deepEqual(s[0]!.Resource, [`arn:aws:logs:eu-west-2:${ACCOUNT}:log-group:/aws/lambda/top-tracks-analysis:*`]);
    assert.ok(!JSON.stringify(rolePolicy(ACCOUNT)).includes('"*"'), "no wildcard resource");
    assert.ok(!/s3:|secretsmanager:|ssm:/.test(JSON.stringify(rolePolicy(ACCOUNT))), "no storage or secret access");
  });

  it("only Lambda in this account assumes it", () => {
    const s = statements(trustPolicy(ACCOUNT) as never)[0]!;
    assert.deepEqual(s.Principal, { Service: "lambda.amazonaws.com" });
    assert.deepEqual(s.Condition, { StringEquals: { "aws:SourceAccount": ACCOUNT } });
  });

  it("the app's user may invoke this one function", () => {
    const s = statements(invokePolicy(ACCOUNT));
    assert.equal(s.length, 1);
    assert.deepEqual(s[0]!.Action, ["lambda:InvokeFunction"]);
    assert.deepEqual(s[0]!.Resource, [arns(ACCOUNT).function]);
    assert.equal(arns(ACCOUNT).function, `arn:aws:lambda:eu-west-2:${ACCOUNT}:function:top-tracks-analysis`);
  });

  it("the repository lets Lambda pull for this function only", () => {
    const s = statements(repositoryPolicy(ACCOUNT) as never)[0]!;
    assert.deepEqual(s.Action, ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]);
    assert.deepEqual(s.Condition, { StringLike: { "aws:sourceArn": arns(ACCOUNT).function } });
  });
});

describe("the function", () => {
  it("is 4096 MB, 600 s, arm64, with 1 GB of /tmp and the audio hosts", () => {
    const f = functionSettings(ACCOUNT, HOSTS);
    assert.equal(f.MemorySize, 4096);
    assert.equal(f.Timeout, 600);
    assert.deepEqual(f.Architectures, ["arm64"]);
    assert.equal(f.EphemeralStorage.Size, 1024);
    assert.equal(f.Role, `arn:aws:iam::${ACCOUNT}:role/top-tracks-analysis-role`);
    assert.deepEqual(f.Environment.Variables, { AUDIO_URL_HOSTS: "abcdefghijkl.supabase.co", MAX_AUDIO_SECONDS: "480" });
    assert.equal(FUNCTION_RESERVED_CONCURRENCY, 2);
    assert.equal(HOST.region, "eu-west-2");
  });

  it("the timeout covers the longest track it accepts at the write-up's slow end (1.1x real time) plus a cold start", () => {
    assert.ok(FUNCTION_TIMEOUT_SECONDS >= MAX_AUDIO_SECONDS * 1.1 + 30);
    assert.ok(FUNCTION_TIMEOUT_SECONDS <= 900, "Lambda's maximum");
  });

  it("an update touches only what differs", () => {
    const want = functionSettings(ACCOUNT, HOSTS);
    const live = { ...want, Architectures: ["arm64"] };
    assert.deepEqual(settingsDiffer(live, want), []);
    assert.deepEqual(settingsDiffer({ ...live, MemorySize: 2048 }, want), ["MemorySize"]);
    assert.deepEqual(settingsDiffer({ ...live, Environment: { Variables: { AUDIO_URL_HOSTS: "other.supabase.co", MAX_AUDIO_SECONDS: "480" } } }, want), ["Environment"]);
    assert.deepEqual(settingsDiffer({ ...live, Environment: { Variables: { ...want.Environment.Variables, EXTRA: "1" } } }, want), ["Environment"]);
  });

  it("fetches audio only from the Supabase project's host (and any extra named)", () => {
    assert.deepEqual(audioHostsFrom("https://abcdefghijkl.supabase.co"), HOSTS);
    assert.deepEqual(audioHostsFrom("https://abcdefghijkl.supabase.co", ["", " CDN.example.com "]), ["abcdefghijkl.supabase.co", "cdn.example.com"]);
    assert.throws(() => audioHostsFrom(undefined), /no audio host/);
    assert.throws(() => audioHostsFrom("http://abcdefghijkl.supabase.co"), /https/);
  });
});

describe("cost and alarms", () => {
  it("a whole track (2–5 min) costs about $0.006–0.016 at 4 GB arm64", () => {
    assert.ok(Math.abs(costPerCallUsd(120) - 0.0064) < 0.0001);
    assert.ok(Math.abs(costPerCallUsd(300) - 0.016) < 0.0001);
    assert.ok(Math.abs(worstCaseDailyUsd() - 9.22) < 0.01);
  });

  it("two function alarms: over an hour of compute in an hour, over 150 calls a day, both to the topic", () => {
    const list = alarms("arn:aws:sns:eu-west-2:123456789012:top-tracks-analysis-alarms");
    assert.deepEqual(list.map((a) => [a.AlarmName, a.MetricName, a.Period, a.Threshold]), [
      ["top-tracks-analysis-compute-hour", "Duration", 3600, 3_600_000],
      ["top-tracks-analysis-calls-day", "Invocations", 86_400, 150],
    ]);
    for (const a of list) {
      assert.ok(a.Period * a.EvaluationPeriods <= 86_400, "CloudWatch's one-day limit");
      assert.deepEqual(a.Dimensions, [{ Name: "FunctionName", Value: "top-tracks-analysis" }]);
      assert.deepEqual(a.AlarmActions, ["arn:aws:sns:eu-west-2:123456789012:top-tracks-analysis-alarms"]);
    }
    // The compute alarm is below what the cap allows in an hour, so a loop trips it.
    assert.ok(list[0]!.Threshold < FUNCTION_RESERVED_CONCURRENCY * 3_600_000);
    assert.ok(costPerCallUsd(list[0]!.Threshold / 1000) < 0.2);
  });
});
