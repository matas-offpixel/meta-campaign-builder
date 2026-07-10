import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAutorespJourneyDefinition,
  buildContactAddedToGroupTrigger,
  resolveAutorespJourneyDefinition,
  type JourneyStepGraph,
} from "../definition.ts";

// ── Trigger shape ────────────────────────────────────────────────────────

// CONFIRMED against every live journey read (C26-Barcelona, T26-London,
// MAD26 RAZZMATAZZ, ...) — .scratch/bird-journey-version-detail.json /
// probe #2's post-cleanup verify listing, 2026-07-09/10.
test("buildContactAddedToGroupTrigger matches the live-read shape byte-exact", () => {
  const trigger = buildContactAddedToGroupTrigger("3167a16a-6556-4b58-8422-3f4c261f79df");
  assert.deepEqual(trigger, {
    type: "journey-contact",
    data: {
      contextConditions: {},
      event: "contact-added-to-group",
      groupId: "3167a16a-6556-4b58-8422-3f4c261f79df",
    },
  });
});

// ── Definition (step graph) shape ───────────────────────────────────────

// CONFIRMED byte-exact against the live published-journey read
// (C26-Barcelona, .scratch/bird-journey-version-detail.json, 2026-07-09).
// Step-id suffixes in the live read are Bird-generated per-write and not a
// stable convention we can/should hardcode-match; the test instead follows
// startAt / next references (robust to whatever ids our builder mints) and
// byte-diffs everything else.
const CAPTURED_SEND_STEP_PARAMETERS = {
  payload: {
    capFrequency: true,
    flowTaskExtension: {
      navigatorId: "",
      runHoldoutEnabled: false,
      useNavigator: false,
    },
    ignoreGlobalHoldout: false,
    ignoreQuietHours: false,
    meta: { pushNotifications: { gatewayTypeOverride: "" } },
    receiver: { contacts: [{ id: "{{contact.id}}" }] },
    template: {
      locale: "en",
      name: "",
      projectId: "d53fa0e9-5c53-4bee-8f07-453d41ac53ab",
      variables: {},
      version: "de09ce6b-7cbb-4b3c-a203-c747df25edcb",
    },
    utm: { enabled: true },
  },
  request: {
    channelId: "bb6e267e-ea17-5bb1-8895-11746322b018",
    workspaceId: "{{run.workspaceId}}",
  },
};

function sendStepOf(graph: JourneyStepGraph) {
  return graph.steps[graph.startAt] as {
    type: string;
    parameters: Record<string, unknown>;
    next: string;
  };
}

test("buildAutorespJourneyDefinition: send-step parameters are byte-exact against the live capture", () => {
  const result = buildAutorespJourneyDefinition({
    template: {
      projectId: "d53fa0e9-5c53-4bee-8f07-453d41ac53ab",
      version: "de09ce6b-7cbb-4b3c-a203-c747df25edcb",
      locale: "en",
    },
    variables: {},
    channelId: "bb6e267e-ea17-5bb1-8895-11746322b018",
  });

  const sendStep = sendStepOf(result);
  assert.ok(sendStep, "startAt must reference an existing step");
  assert.equal(sendStep.type, "mrn:v1:channels:endpoints:createChannelMessage:1.0.0");
  assert.deepEqual(sendStep.parameters, CAPTURED_SEND_STEP_PARAMETERS);

  const terminateStep = result.steps[sendStep.next] as Record<string, unknown>;
  assert.ok(terminateStep, "send step's next must reference an existing step");
  assert.deepEqual(terminateStep, {
    type: "terminate",
    parameters: { code: "", fail: false, reason: "" },
  });
});

test("buildAutorespJourneyDefinition: binds real template variables into the send step", () => {
  const result = buildAutorespJourneyDefinition({
    template: { projectId: "proj-1", version: "ver-1", locale: "es-ES" },
    variables: { event_name: "Jackies - Malaga", event_date: "sábado 14 junio" },
    channelId: "chan-1",
  });
  const sendStep = sendStepOf(result);
  const payload = sendStep.parameters.payload as { template: Record<string, unknown> };
  assert.deepEqual(payload.template, {
    locale: "es-ES",
    name: "",
    projectId: "proj-1",
    variables: { event_name: "Jackies - Malaga", event_date: "sábado 14 junio" },
    version: "ver-1",
  });
  assert.equal((sendStep.parameters.request as Record<string, unknown>).channelId, "chan-1");
});

test("buildAutorespJourneyDefinition is pure — same input, same output, deterministic", () => {
  const input = {
    template: { projectId: "p", version: "v", locale: "en" },
    variables: { a: "1" },
    channelId: "c",
  };
  assert.deepEqual(buildAutorespJourneyDefinition(input), buildAutorespJourneyDefinition(input));
});

// ── Composition: resolveAutorespJourneyDefinition ───────────────────────

const BASE_EVENT = {
  name: "Jackies - Malaga",
  event_start_at: "2026-08-15T20:00:00Z",
  presale_at: "2026-07-20T10:00:00Z",
  ticket_url: "https://ra.co/events/2123456",
};
const BASE_COPY = {
  artwork_url: "https://cdn.example.com/artwork.jpg",
  whatsapp_community_url: "https://chat.whatsapp.com/ABCDEFG12345",
};

test("resolveAutorespJourneyDefinition: composes resolveBirdTemplateInfo + resolveBirdTemplateVariables", () => {
  const result = resolveAutorespJourneyDefinition({
    audience: { project_id: "proj-9", template_id: "ver-9", locale: "en" },
    variables: {},
    event: BASE_EVENT,
    copy: BASE_COPY,
    timezone: "Europe/London",
    channelId: "chan-9",
  });

  assert.ok(result, "expected a resolved definition");
  assert.deepEqual(result!.templateInfo, {
    projectId: "proj-9",
    versionId: "ver-9",
    locale: "en",
  });

  const sendStep = sendStepOf(result!.definition);
  const payload = sendStep.parameters.payload as { template: { variables: Record<string, string> } };
  assert.equal(payload.template.variables.event_name, "Jackies - Malaga");
  assert.equal(payload.template.variables.event_url_suffix, "2123456");
  // Invite code, not the full URL (double-domain bug this resolver already guards against).
  assert.equal(payload.template.variables.wa_community_invite, "ABCDEFG12345");
});

test("resolveAutorespJourneyDefinition: falls back to bird_template_* variable keys (Bug B path)", () => {
  const result = resolveAutorespJourneyDefinition({
    audience: {},
    variables: { bird_template_project_id: "proj-fallback", bird_template_version_id: "ver-fallback" },
    event: BASE_EVENT,
    copy: BASE_COPY,
    timezone: "Europe/London",
    channelId: "chan-1",
  });
  assert.ok(result);
  assert.equal(result!.templateInfo.projectId, "proj-fallback");
  assert.equal(result!.templateInfo.versionId, "ver-fallback");
});

test("resolveAutorespJourneyDefinition: returns null when no template identity resolves", () => {
  const result = resolveAutorespJourneyDefinition({
    audience: {},
    variables: {},
    event: BASE_EVENT,
    copy: BASE_COPY,
    timezone: "Europe/London",
    channelId: "chan-1",
  });
  assert.equal(result, null);
});
