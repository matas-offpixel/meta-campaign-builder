import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  DRAFT_CAMPAIGN_VERIFIED,
  birdCampaignEditUrl,
  buildBroadcastPatch,
  createDraftCampaign,
  defaultBroadcastSchedule,
} from "../client.ts";

const BASE_INPUT = {
  apiKey: "ak-test",
  workspaceId: "9c308f77-c5ed-44d3-9714-9da017c7536c",
  channelId: "322236d8-c182-4d32-bcdc-2e96f833ccfc",
  projectId: "53b26928-1df2-4d7a-a40a-8a92abc44429",
  projectVersionId: "7f913243-a9ca-4485-b0bd-0e4c13302375",
  name: "j26-mallorca_presale_live_20260801",
  defaultLocale: "es-ES",
  variables: { event_name: "Jackies - Malaga", event_date: "sábado 14 junio" },
} as const;

let origFetch: typeof fetch;
let calls: { method: string; url: string; body?: string }[];

beforeEach(() => {
  origFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

/** Sequenced mock for the nested create: GET list → POST campaign → POST broadcast → PATCH. */
function mockCreateFlow(opts: {
  list?: unknown[];
  campaignId?: string;
  broadcastId?: string;
  broadcastSchedule?: unknown;
}) {
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url), body: init?.body as string | undefined });
    const step = i++;
    if (step === 0) return new Response(JSON.stringify({ results: opts.list ?? [] }), { status: 200 });
    if (method === "POST" && String(url).endsWith("/campaigns"))
      return new Response(JSON.stringify({ id: opts.campaignId ?? "camp-1" }), { status: 201 });
    if (method === "POST" && String(url).includes("/broadcasts"))
      return new Response(
        JSON.stringify({ id: opts.broadcastId ?? "bc-1", schedule: opts.broadcastSchedule }),
        { status: 201 },
      );
    return new Response("{}", { status: 200 }); // PATCH
  }) as unknown as typeof fetch;
}

test("DRAFT_CAMPAIGN_VERIFIED is flipped on (endpoint reconciled with capture)", () => {
  assert.equal(DRAFT_CAMPAIGN_VERIFIED, true);
});

test("createDraftCampaign: nested flow (POST campaign → POST broadcast → PATCH)", async () => {
  mockCreateFlow({ campaignId: "camp-1", broadcastId: "bc-1" });
  const res = await createDraftCampaign({ ...BASE_INPUT });

  assert.equal(res.existed, false);
  assert.equal(res.campaignId, "camp-1");
  assert.equal(res.broadcastId, "bc-1");
  assert.equal(res.editUrl, birdCampaignEditUrl(BASE_INPUT.workspaceId, "camp-1"));
  assert.match(res.editUrl, /^https:\/\/app\.bird\.com\/workspaces\/.+\/campaigns\/camp-1$/);

  const methods = calls.map((c) => c.method);
  assert.deepEqual(methods, ["GET", "POST", "POST", "PATCH"]);

  // PATCH carries the channel_template content with projectVersionId + variables.
  const patch = JSON.parse(calls[3].body ?? "{}");
  assert.equal(patch.content.type, "channel_template");
  assert.equal(patch.content.channelTemplate.projectId, BASE_INPUT.projectId);
  assert.equal(patch.content.channelTemplate.projectVersionId, BASE_INPUT.projectVersionId);
  assert.deepEqual(patch.content.channelTemplate.variables, BASE_INPUT.variables);
  assert.equal(patch.channels.platforms[0].channels[0].id, BASE_INPUT.channelId);
  assert.equal(patch.channels.platforms[0].selection, "random");
});

test("createDraftCampaign: idempotency — existing campaign returned, no create POSTs", async () => {
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url) });
    if (i++ === 0)
      return new Response(
        JSON.stringify({ results: [{ id: "camp-existing", name: BASE_INPUT.name, status: "draft" }] }),
        { status: 200 },
      );
    // firstBroadcastId GET
    return new Response(JSON.stringify({ results: [{ id: "bc-existing" }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const res = await createDraftCampaign({ ...BASE_INPUT });
  assert.equal(res.existed, true);
  assert.equal(res.campaignId, "camp-existing");
  assert.equal(res.broadcastId, "bc-existing");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "no create POSTs on skip");
});

// ── PATCH payload shape vs the captured configured broadcast (capture §4) ─────

/** Capture §4 (configured broadcast) minus server-computed fields. */
const CAPTURED_CONFIGURED_MINUS_COMPUTED = {
  status: "draft",
  type: "channel",
  audience: {
    type: "group",
    group: { groupId: "9386300f-2c97-4d75-ad41-2c87aeedcb2c" },
    frequencyCapEnabled: true,
  },
  content: {
    type: "channel_template",
    channelTemplate: {
      projectId: "53b26928-1df2-4d7a-a40a-8a92abc44429",
      projectVersionId: "7f913243-a9ca-4485-b0bd-0e4c13302375",
      defaultLocale: "es-ES",
    },
  },
  channels: {
    platforms: [
      {
        platformId: "whatsapp",
        channelIds: null,
        navigatorId: null,
        channels: [{ id: "322236d8-c182-4d32-bcdc-2e96f833ccfc" }],
        selection: "random",
      },
    ],
    prioritizeContactTimezone: false,
    prioritizeContactLocale: false,
  },
  schedule: {
    startsAt: "2026-07-01T23:11:04Z",
    timezone: "recipient-local",
    timeInPastBehavior: "send-immediately",
    missingTimeZoneBehavior: "workspace-timezone",
  },
  recipients: {
    include: [{ type: "group", id: "9386300f-2c97-4d75-ad41-2c87aeedcb2c" }],
    capFrequency: true,
    holdoutPercentage: 0,
    ignoreGlobalHoldout: false,
  },
  tracking: { includeParameters: true },
  localeMatching: "user_locale_or_default",
  localeRules: { localeMatching: "user_locale_or_default" },
};

test("buildBroadcastPatch matches captured configured broadcast (minus computed fields)", () => {
  const patch = buildBroadcastPatch({
    projectId: "53b26928-1df2-4d7a-a40a-8a92abc44429",
    projectVersionId: "7f913243-a9ca-4485-b0bd-0e4c13302375",
    defaultLocale: "es-ES",
    variables: {}, // capture had variables unset (its 6 _issues) — omit key to match exactly
    channelId: "322236d8-c182-4d32-bcdc-2e96f833ccfc",
    schedule: CAPTURED_CONFIGURED_MINUS_COMPUTED.schedule,
    recipients: { include: [{ type: "group", id: "9386300f-2c97-4d75-ad41-2c87aeedcb2c" }] },
  });
  assert.deepEqual(patch, CAPTURED_CONFIGURED_MINUS_COMPUTED);
});

test("buildBroadcastPatch binds template variables when provided", () => {
  const patch = buildBroadcastPatch({
    projectId: "p",
    projectVersionId: "v",
    defaultLocale: "es-ES",
    variables: { event_name: "Jackies - Malaga", event_date: "sábado 14 junio" },
    channelId: "chan",
    schedule: defaultBroadcastSchedule("2026-08-01T09:00:00Z"),
  });
  const content = patch.content as { channelTemplate: { variables: Record<string, string> } };
  assert.deepEqual(content.channelTemplate.variables, {
    event_name: "Jackies - Malaga",
    event_date: "sábado 14 junio",
  });
  // No recipients provided → no audience/recipients keys (empty draft, Matas picks).
  assert.equal("audience" in patch, false);
  assert.equal("recipients" in patch, false);
});
