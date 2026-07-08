/**
 * lib/d2c/bird/provider.ts
 *
 * Bird.com adapter — SMS + WhatsApp Cloud API provider. Real implementation
 * behind the 3-of-3 dry-run gate (global flag + per-connection live_enabled +
 * approved_by_matas), identical to the Mailchimp gate.
 *
 * Credentials shape: { api_key, workspace_id, channel_id }.
 *   - api_key      — workspace access key (long-lived).
 *   - workspace_id — the Bird workspace UUID.
 *   - channel_id   — the WhatsApp/SMS channel connector id.
 *
 * All HTTP goes through ./client.ts.
 */

import { performDryRun } from "../dry-run.ts";
import { birdJson } from "./client.ts";
import { substituteTemplateVariables } from "../event-variables.ts";
import {
  shouldD2CDryRun,
  d2cDryRunGates,
  type D2CConnection,
  type D2CMessage,
  type D2CProvider,
  type SendResult,
  type ValidateD2CCredentialsResult,
} from "../types.ts";

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface BirdTemplateInfo {
  projectId: string;
  versionId: string;
  locale: string;
}

/**
 * Bug B fix (2026-07-08): resolve WhatsApp template identity from BOTH
 * conventions live in this codebase — `audience.project_id`/`template_id`
 * (what this provider originally assumed, and what `fire.ts`'s real
 * webhook/poll autoresp path still spreads `send.audience` into) and
 * `variables.bird_template_project_id`/`bird_template_version_id` (what WA
 * `d2c_scheduled_sends` rows actually persist for announce/reminder/
 * presale_live/gen_sale/autoresp_setup — verified live against the
 * Throwback Algarve event). Audience wins when both are present (explicit
 * per-send override, e.g. a future test-send that deliberately swaps
 * templates). Without this, `isTemplateSend` was ALWAYS false for every
 * real WA send in production — every fire silently downgraded to the empty
 * body-text path (see Bug A) instead of firing the approved WhatsApp
 * template. Exported so both this provider and the test-send route (which
 * copies the resolved ids onto its ephemeral audience as defence-in-depth)
 * share one resolution rule. Pure.
 */
export function resolveBirdTemplateInfo(
  audience: Record<string, unknown>,
  variables: Record<string, unknown>,
): BirdTemplateInfo | null {
  const projectId =
    readString(audience, "project_id") ??
    readString(variables, "bird_template_project_id");
  const versionId =
    readString(audience, "template_id") ??
    readString(variables, "bird_template_version_id");
  if (!projectId || !versionId) return null;
  const locale =
    readString(audience, "locale") ?? readString(variables, "locale") ?? "en";
  return { projectId, versionId, locale };
}

/**
 * Layers 6 & 9 of the 2026-07-01 direct-fire incident — RECONCILED 2026-07-02
 * against `.scratch/bird-runtime-send-capture.txt`.
 *
 * Provenance note: that file is NOT a DevTools capture. Bird's own UI test-send
 * flow does not surface the payload in the Network panel (suspected server
 * action / batched dispatch), so the shape below is sourced from Bird's public
 * API docs (channels-api/message-types/template, send-batch-messages) instead.
 * That is real, official-source evidence — not a derived-from-conventions
 * guess — but ONE piece remains genuinely unverified: the `list_id`-targeted
 * receiver shape (docs only show the phone-identifier form). See the
 * `list_id` branch below and docs/D2C_LIVE_FIRE_RUNBOOK.md for the fallback
 * chain to try if Bird 422s on it.
 *
 * What was wrong (layer 6): `receiver: { contacts: { listId } }` sent contacts
 * as an OBJECT; Bird requires an array — `422 "value must be an array"`.
 *
 * What was wrong (layer 9): the template body was nested under `body.template`
 * with `{ name, locale, components: [...] }` — the WhatsApp Cloud API (Meta
 * direct) shape. Bird's own `/messages` endpoint instead wants `template` as a
 * TOP-LEVEL sibling of `receiver` (no `body` field for template sends), keyed
 * by `projectId` + `version` (not `name`), with a FLAT `parameters` array
 * (`{ type, key, value }`) — no `components` wrapper.
 */
export const BIRD_RUNTIME_SEND_VERIFIED = true;

/** Exposed for tests + the connections UI — mirrors the Mailchimp helper. */
export function birdDryRunGatesBlockLiveSend(connection: D2CConnection): {
  featureOff: boolean;
  liveDisabled: boolean;
  notMatasApproved: boolean;
} {
  return d2cDryRunGates(connection);
}

export class BirdProvider implements D2CProvider {
  readonly name = "bird" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult> {
    const apiKey = readString(credentials, "api_key");
    const workspaceId = readString(credentials, "workspace_id");
    if (!apiKey || !workspaceId) {
      return {
        ok: false,
        error: "api_key and workspace_id are required.",
      };
    }
    try {
      await birdJson<unknown>(
        apiKey,
        `/workspaces/${workspaceId}/channels`,
        { method: "GET" },
      );
      return { ok: true, externalAccountId: workspaceId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bird channel check failed.";
      return { ok: false, error: msg };
    }
  }

  async send(
    connection: D2CConnection,
    message: D2CMessage,
  ): Promise<SendResult> {
    if (shouldD2CDryRun(connection)) {
      return performDryRun(this.name, message);
    }

    const creds =
      connection.credentials && typeof connection.credentials === "object"
        ? (connection.credentials as Record<string, unknown>)
        : {};
    const apiKey = readString(creds, "api_key");
    const workspaceId = readString(creds, "workspace_id");
    // Per-send override for multi-brand-per-client setups (e.g. Throwback +
    // Hop on the Top share one d2c_connections row — UNIQUE(user_id,
    // client_id, provider) forbids a second Bird row per client — but each
    // brand's sends carry their own WhatsApp channel in audience.channel_id).
    // Falls back to the connection-level credential for legacy single-brand
    // clients that never set a per-send channel_id.
    const channelId =
      readString(
        (message.audience ?? {}) as Record<string, unknown>,
        "channel_id",
      ) ?? readString(creds, "channel_id");
    if (!apiKey || !workspaceId || !channelId) {
      return {
        ok: false,
        dryRun: false,
        error: "Missing Bird api_key, workspace_id or channel_id on connection.",
      };
    }

    // Layers 6 & 9: retained as a live re-gating point. Currently a no-op
    // (BIRD_RUNTIME_SEND_VERIFIED = true) — flip back to false if a future
    // shape regression is discovered before it can be reconciled.
    if (message.channel === "whatsapp" && !BIRD_RUNTIME_SEND_VERIFIED) {
      return {
        ok: false,
        dryRun: false,
        error:
          "BIRD_RUNTIME_UNVERIFIED: live WhatsApp send blocked — BIRD_RUNTIME_SEND_VERIFIED is false. " +
          "See docs/D2C_LIVE_FIRE_RUNBOOK.md.",
      };
    }

    const audience = message.audience ?? {};
    const variables = Object.fromEntries(
      Object.entries(message.variables ?? {}).map(([k, v]) => [
        k,
        v === null || v === undefined ? "" : String(v),
      ]),
    );

    // Recipients: provider-specific. Accept either an explicit list of
    // identifiers or a Bird list/segment id on the audience descriptor.
    const recipients = Array.isArray(audience.recipients)
      ? (audience.recipients as unknown[]).map((r) => String(r))
      : [];
    const listId =
      typeof audience.list_id === "string" ? audience.list_id.trim() : null;
    if (recipients.length === 0 && !listId) {
      return {
        ok: false,
        dryRun: false,
        error: "Bird sends require audience.recipients[] or audience.list_id.",
      };
    }

    // WhatsApp template identity: Bird templates are addressed by
    // projectId + version (the Studio project + published version UUID),
    // NOT by name. `template_id` here maps to Bird's `version` field — same
    // naming Cursor already uses for the draft-campaign flow
    // (OrchestrationInput.bird.projectId / .templateId, see orchestration/index.ts).
    // See resolveBirdTemplateInfo's doc for why this checks both audience AND
    // variables (Bug B, 2026-07-08).
    const templateInfo = resolveBirdTemplateInfo(
      audience as Record<string, unknown>,
      message.variables ?? {},
    );

    const renderedBody = substituteTemplateVariables(
      message.bodyMarkdown,
      variables,
    );

    const isTemplateSend = message.channel === "whatsapp" && templateInfo !== null;

    // Bird's /messages endpoint shapes `receiver` identically for either send
    // type. `list_id`-targeted receiver shape is the one item NOT covered by
    // Bird's public docs (only phone-identifier receivers are documented) —
    // this is the single residual guess in this payload. If Bird 422s on it,
    // try (in order): `{ contacts: [{ listType: "list", listId }] }`, then
    // fall back to a preflight GET on the list to resolve individual
    // identifierValue contacts. See docs/D2C_LIVE_FIRE_RUNBOOK.md.
    const receiver = listId
      ? { contacts: [{ listId }] }
      : { contacts: recipients.map((id) => ({ identifierValue: id })) };

    // Template sends and plain-text sends are mutually exclusive top-level
    // shapes on Bird's /messages endpoint: template sends carry `template`
    // (no `body` field); non-template sends carry `body` (no `template`
    // field). Never both.
    const body: Record<string, unknown> = isTemplateSend
      ? {
          receiver,
          template: {
            projectId: templateInfo!.projectId,
            version: templateInfo!.versionId,
            locale: templateInfo!.locale,
            // Flat parameter array — Bird's own abstraction over the
            // WhatsApp Cloud API's nested components[].parameters[] shape.
            parameters: Object.entries(variables).map(([key, value]) => ({
              type: "string",
              key,
              value,
            })),
          },
        }
      : {
          receiver,
          body: { type: "text", text: { text: renderedBody } },
        };

    try {
      // Response envelope is inferred (Bird's docs don't show a success
      // sample) as `{ id: "<message_uuid>", … }` — unconfirmed until a real
      // send. `res.id` degrades to `null` harmlessly if the field differs.
      const res = await birdJson<{ id?: string }>(
        apiKey,
        `/workspaces/${workspaceId}/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      return {
        ok: true,
        dryRun: false,
        providerJobId: res.id ?? null,
        details: res,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Bird send failed.";
      return { ok: false, dryRun: false, error: msg };
    }
  }
}

export const birdProvider = new BirdProvider();
