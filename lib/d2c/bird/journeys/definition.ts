/**
 * lib/d2c/bird/journeys/definition.ts
 *
 * Pure builder for a Journey's `trigger` and version `definition` (step
 * graph) — the "contact added to group -> send WhatsApp template" shape.
 *
 * CONFIRMED byte-exact against a live published journey read (`C26-Barcelona`,
 * `.scratch/bird-journey-version-detail.json`, 2026-07-09) — see
 * docs/D2C_BIRD_FLOW_AUTOMATION_INVESTIGATION.md "Action: send WhatsApp
 * template with variables -> confirmed". No `JOURNEY_CREATE_VERIFIED` gate:
 * these are pure functions with zero network calls — it's the *shape* that's
 * confirmed here, independent of whether the write-call sequence to persist
 * it onto a real journey/version is confirmed yet (that's
 * `lib/d2c/bird/journeys/client.ts`'s `writeJourneyVersion`, still TBD).
 *
 * Reuses the already-shipped variable/template resolvers — no new variable
 * logic or identity-resolution rule:
 *   - `resolveBirdTemplateInfo` (lib/d2c/bird/provider.ts) — Project+Version
 *     template identity, same Bug B fix (2026-07-08) every other Bird send
 *     path already relies on.
 *   - `resolveBirdTemplateVariables` (lib/d2c/bird/template-variables.ts) —
 *     the 7-variable union across every registered throwback/jackies
 *     template.
 */

import {
  resolveBirdTemplateInfo,
  type BirdTemplateInfo,
} from "../provider.ts";
import {
  resolveBirdTemplateVariables,
  type BirdTemplateVarInput,
} from "../template-variables.ts";

export interface JourneyContactAddedToGroupTrigger {
  type: "journey-contact";
  data: {
    contextConditions: Record<string, never>;
    event: "contact-added-to-group";
    groupId: string;
  };
}

/**
 * The journey envelope's trigger shape. CONFIRMED against every live
 * journey read (C26-Barcelona, T26-London, MAD26 RAZZMATAZZ, ...) — all
 * share this identical `journey-contact` / `contact-added-to-group` shape,
 * differing only in `groupId`.
 */
export function buildContactAddedToGroupTrigger(
  groupId: string,
): JourneyContactAddedToGroupTrigger {
  return {
    type: "journey-contact",
    data: { contextConditions: {}, event: "contact-added-to-group", groupId },
  };
}

export interface JourneyTemplateRef {
  projectId: string;
  /** Bird's `version` field — same Project+Version identity model used across lib/d2c/bird/*. */
  version: string;
  locale: string;
}

export interface BuildAutorespJourneyDefinitionInput {
  template: JourneyTemplateRef;
  variables: Record<string, string>;
  channelId: string;
}

export interface JourneyStepGraph {
  startAt: string;
  steps: Record<string, unknown>;
}

const SEND_STEP_ID = "createChannelMessage_1";
const TERMINATE_STEP_ID = "terminate_1";

/**
 * Builds the version `definition` (step graph): one `createChannelMessage`
 * send step -> `terminate`. Byte-exact against the live read's `payload`
 * shape, including the fields the original outline's candidate omitted
 * (`flowTaskExtension`, `ignoreQuietHours`, `meta.pushNotifications`).
 */
export function buildAutorespJourneyDefinition(
  input: BuildAutorespJourneyDefinitionInput,
): JourneyStepGraph {
  return {
    startAt: SEND_STEP_ID,
    steps: {
      [SEND_STEP_ID]: {
        type: "mrn:v1:channels:endpoints:createChannelMessage:1.0.0",
        parameters: {
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
              locale: input.template.locale,
              name: "",
              projectId: input.template.projectId,
              variables: input.variables,
              version: input.template.version,
            },
            utm: { enabled: true },
          },
          request: { channelId: input.channelId, workspaceId: "{{run.workspaceId}}" },
        },
        next: TERMINATE_STEP_ID,
      },
      [TERMINATE_STEP_ID]: {
        type: "terminate",
        parameters: { code: "", fail: false, reason: "" },
      },
    },
  };
}

export interface ResolveAutorespJourneyDefinitionInput {
  /** Same shape armAutoresponder already reads (project_id/template_id or bird_template_* fallback). */
  audience: Record<string, unknown>;
  variables: Record<string, unknown>;
  event: BirdTemplateVarInput["event"];
  copy: BirdTemplateVarInput["copy"];
  timezone: string;
  channelId: string;
}

export interface ResolveAutorespJourneyDefinitionResult {
  definition: JourneyStepGraph;
  templateInfo: BirdTemplateInfo;
}

/**
 * Composes the two existing resolvers into the full journey version
 * definition. Returns `null` when no approved template identity can be
 * resolved (same "no send" signal `fireAutorespToMember` already treats as a
 * skip) — callers should surface this as a clear "template not configured"
 * outcome rather than attempting a journey write with an incomplete shape.
 */
export function resolveAutorespJourneyDefinition(
  input: ResolveAutorespJourneyDefinitionInput,
): ResolveAutorespJourneyDefinitionResult | null {
  const templateInfo = resolveBirdTemplateInfo(input.audience, input.variables);
  if (!templateInfo) return null;

  const templateVariables = resolveBirdTemplateVariables({
    event: input.event,
    copy: input.copy,
    timezone: input.timezone,
  });

  const definition = buildAutorespJourneyDefinition({
    template: {
      projectId: templateInfo.projectId,
      version: templateInfo.versionId,
      locale: templateInfo.locale,
    },
    variables: templateVariables,
    channelId: input.channelId,
  });

  return { definition, templateInfo };
}
