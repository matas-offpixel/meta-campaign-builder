import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BIRD_JOB_TYPES,
  JOB_PRIMARY_CHANNEL,
  MAILCHIMP_JOB_TYPES,
  orchestrateJob,
  planJob,
  providerForChannel,
  type OrchestrationInput,
} from "../../orchestration/index.ts";
import { buildEventTag } from "../../orchestration/tags.ts";
import type { D2CJobType } from "../../types.ts";

const FAKE_EVENT = {
  brand: "jackies",
  eventCode: "j26-mallorca-pdm",
  variables: {
    EVENT_NAME: "Jackies pres. Paradise de Martin",
    EVENT_DATE: "2026-08-15",
    PRESALE_DAY: "Monday",
    PRESALE_TIME: "10:00",
    TICKET_URL: "https://ra.co/events/2375157",
    community_url: "https://chat.whatsapp.com/IPCpHTE8JMu9JT5DenZglv",
  },
  connection: { id: "conn-jackies", live_enabled: false, approved_by_matas: false },
};

function inputFor(jobType: D2CJobType, channel: string): OrchestrationInput {
  return {
    jobType,
    channel,
    brand: FAKE_EVENT.brand,
    eventCode: FAKE_EVENT.eventCode,
    connection: FAKE_EVENT.connection,
    variables: FAKE_EVENT.variables,
    scheduleTimeIso: "2026-08-01T09:00:00Z",
    mailchimp: { templateName: `jackies_${jobType === "announce" ? "announcement" : jobType}`, audienceName: "Jackies", replyTo: "hi@jackies.example" },
    bird: { projectId: "proj-1", templateId: "tpl-1", templateStatus: "pending" },
  };
}

test("fake Jackies event: 6 job types dispatch as dry-run (no live flags)", async () => {
  const jobTypes: D2CJobType[] = [
    "announce",
    "autoresp_setup",
    "community_early",
    "reminder",
    "presale_live",
    "gen_sale",
  ];
  const rows: { job_type: D2CJobType; channel: string; provider: string; dry_run: boolean }[] = [];

  for (const jt of jobTypes) {
    const channel = JOB_PRIMARY_CHANNEL[jt];
    // deps intentionally empty — dry-run must never touch the executors
    const res = await orchestrateJob(inputFor(jt, channel), {});
    assert.equal(res.ok, true, `${jt} ok`);
    assert.equal(res.dryRun, true, `${jt} is dry-run`);
    assert.equal(res.tag, buildEventTag(FAKE_EVENT.brand, FAKE_EVENT.eventCode));
    rows.push({ job_type: jt, channel, provider: res.provider, dry_run: res.dryRun });
  }

  assert.equal(rows.length, 6, "6 scheduled_sends rows");
  assert.ok(rows.every((r) => r.dry_run === true), "all rows dry_run=true");

  // Evidence table for the PR / checkpoint (d).
  console.log("\nfake Jackies event — 6 scheduled_sends (dry_run):");
  for (const r of rows) {
    console.log(`  job_type=${r.job_type.padEnd(15)} channel=${r.channel.padEnd(8)} provider=${r.provider.padEnd(9)} dry_run=${r.dry_run}`);
  }
});

test("whatsapp Bird broadcast pivot: reminder/presale_live draft, autoresp direct — all dry-run", async () => {
  // Broadcast pivot: announce/reminder/presale_live/gen_sale → review draft;
  // autoresp_setup/community_early → direct message.
  for (const jt of ["reminder", "presale_live"] as D2CJobType[]) {
    const res = await orchestrateJob(inputFor(jt, "whatsapp"), {});
    assert.equal(res.provider, "bird");
    assert.equal(res.dryRun, true);
    assert.equal(res.plan.action, "draft_campaign", `${jt} → draft`);
    assert.equal(res.draftReady, true, `${jt} draftReady`);
  }
  for (const jt of ["autoresp_setup", "community_early"] as D2CJobType[]) {
    const res = await orchestrateJob(inputFor(jt, "whatsapp"), {});
    assert.equal(res.provider, "bird");
    assert.equal(res.dryRun, true);
    assert.equal(res.plan.action, "message", `${jt} → direct message`);
    assert.ok(!res.draftReady, `${jt} not draftReady`);
  }
});

test("planner routes channels + job types correctly", () => {
  assert.equal(providerForChannel("email"), "mailchimp");
  assert.equal(providerForChannel("whatsapp"), "bird");
  assert.equal(providerForChannel("sms"), "bird");
  assert.ok(MAILCHIMP_JOB_TYPES.includes("announce"));
  assert.ok(BIRD_JOB_TYPES.includes("community_early"));
  // autoresp on email → automation, campaign otherwise
  assert.equal(planJob(inputFor("autoresp_setup", "email")).action, "automation");
  assert.equal(planJob(inputFor("reminder", "email")).action, "campaign");
});

test("planJob is deterministic (idempotent summary)", () => {
  const a = planJob(inputFor("presale_live", "email"));
  const b = planJob(inputFor("presale_live", "email"));
  assert.equal(a.summary, b.summary);
  assert.equal(a.tag, "jackies_j26-mallorca-pdm");
});

test("live send refuses a non-active Bird template (fails loudly, not silently)", async () => {
  // Force the gate open via a live-flagged connection AND FEATURE_D2C_LIVE.
  const prev = process.env.FEATURE_D2C_LIVE;
  process.env.FEATURE_D2C_LIVE = "true";
  try {
    // Use a direct-fire job (autoresp_setup) — draft-review jobs skip the
    // active-check because Matas fires them manually after review.
    const input = inputFor("autoresp_setup", "whatsapp");
    input.connection = { id: "c", live_enabled: true, approved_by_matas: true };
    input.bird!.templateStatus = "pending"; // not active
    const res = await orchestrateJob(input, { bird: { apiKey: "k", workspaceId: "w" } });
    assert.equal(res.ok, false);
    assert.equal(res.dryRun, false);
    assert.match(res.error ?? "", /not active/);
  } finally {
    process.env.FEATURE_D2C_LIVE = prev;
  }
});
