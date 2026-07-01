import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BIRD_DIRECT_FIRE_JOBS,
  BIRD_DRAFT_REVIEW_JOBS,
  draftCampaignName,
  isBirdDraftReviewJob,
  orchestrateJob,
  planJob,
  type OrchestrationInput,
} from "../index.ts";
import type { D2CJobType } from "../../types.ts";

const FAKE = {
  brand: "jackies",
  eventCode: "j26-mallorca-pdm",
  connection: { id: "conn-jackies", live_enabled: false, approved_by_matas: false },
  variables: {
    EVENT_NAME: "Jackies pres. Paradise de Martin",
    TICKET_URL: "https://ra.co/events/2375157",
  },
};

function inputFor(jobType: D2CJobType): OrchestrationInput {
  return {
    jobType,
    channel: "whatsapp",
    brand: FAKE.brand,
    eventCode: FAKE.eventCode,
    connection: FAKE.connection,
    variables: FAKE.variables,
    scheduleTimeIso: "2026-08-01T09:00:00Z",
    bird: {
      projectId: "proj-1",
      templateId: "tpl-1",
      templateStatus: "active",
      channelId: "chan-1",
      locale: "es-ES",
    },
  };
}

test("dry-run cron for fake Jackies event: 4 draft_ready + 2 direct-fire", async () => {
  const allJobs: D2CJobType[] = [
    "announce",
    "reminder",
    "presale_live",
    "gen_sale",
    "autoresp_setup",
    "community_early",
  ];

  const draftRows: D2CJobType[] = [];
  const directRows: D2CJobType[] = [];

  for (const jt of allJobs) {
    // deps empty — dry-run must never touch Bird
    const res = await orchestrateJob(inputFor(jt), {});
    assert.equal(res.ok, true, `${jt} ok`);
    assert.equal(res.dryRun, true, `${jt} dry-run`);
    assert.equal(res.provider, "bird", `${jt} routes to bird on whatsapp`);

    if (res.draftReady) {
      assert.equal(res.plan.action, "draft_campaign", `${jt} draft action`);
      draftRows.push(jt);
    } else {
      assert.equal(res.plan.action, "message", `${jt} direct message action`);
      directRows.push(jt);
    }
  }

  assert.equal(draftRows.length, 4, "4 draft_ready rows");
  assert.equal(directRows.length, 2, "2 direct-fire rows");
  assert.deepEqual(draftRows.sort(), [...BIRD_DRAFT_REVIEW_JOBS].sort());
  assert.deepEqual(directRows.sort(), [...BIRD_DIRECT_FIRE_JOBS].sort());
});

test("isBirdDraftReviewJob classifies broadcast vs personalised sends", () => {
  assert.equal(isBirdDraftReviewJob("announce"), true);
  assert.equal(isBirdDraftReviewJob("gen_sale"), true);
  assert.equal(isBirdDraftReviewJob("autoresp_setup"), false);
  assert.equal(isBirdDraftReviewJob("community_early"), false);
});

test("draftCampaignName is deterministic `${event_code}_${job_type}_${YYYYMMDD}`", () => {
  const name = draftCampaignName("j26-mallorca-pdm", "presale_live", "2026-08-01T09:00:00Z");
  assert.equal(name, "j26-mallorca-pdm_presale_live_20260801");
});

test("planJob draft campaign details carry template + segment tag + variables", () => {
  const plan = planJob(inputFor("announce"));
  assert.equal(plan.action, "draft_campaign");
  assert.equal(plan.details.templateId, "tpl-1");
  assert.equal(plan.details.segmentTag, "jackies_j26-mallorca-pdm");
  assert.ok(plan.summary.includes("Matas reviews"), "summary mentions manual review");
});
