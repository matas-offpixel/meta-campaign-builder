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

/**
 * Layers 6 & 9 of the 2026-07-01 direct-fire incident.
 *
 * The live WhatsApp send shape below is UNVERIFIED against a real Bird runtime
 * capture and produced a 422 tonight:
 *   - Layer 6: `receiver: { contacts: { listId } }` sends contacts as an object;
 *     Bird returned 422 "value must be an array". The correct receiver shape for
 *     a list-targeted send (or whether list_id is accepted at all vs. requiring
 *     a preflight list→contacts expansion) is unknown without a capture.
 *   - Layer 9: the template body uses `template.locale` + keyed
 *     `parameters[].key`; Meta/Bird's runtime WhatsApp API historically expects
 *     `language.code` + positional params. Never verified against a real send.
 *
 * Until `.scratch/bird-runtime-send-capture.txt` lands on main and this code is
 * reconciled against it (same discipline as PR #657's draft-campaign flow), the
 * live WhatsApp send LOUD-FAILS instead of emitting a known-broken payload.
 * Flip to `true` only after reconciling the shapes below against the capture.
 * See docs/D2C_LIVE_FIRE_RUNBOOK.md.
 */
export const BIRD_RUNTIME_SEND_VERIFIED = false;

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
    const channelId = readString(creds, "channel_id");
    if (!apiKey || !workspaceId || !channelId) {
      return {
        ok: false,
        dryRun: false,
        error: "Missing Bird api_key, workspace_id or channel_id on connection.",
      };
    }

    // Layers 6 & 9: refuse to emit the unverified live WhatsApp shape. SMS and
    // any future verified path are unaffected; only the WhatsApp runtime send
    // (the shape that 422'd tonight) is gated.
    if (message.channel === "whatsapp" && !BIRD_RUNTIME_SEND_VERIFIED) {
      return {
        ok: false,
        dryRun: false,
        error:
          "BIRD_RUNTIME_UNVERIFIED: live WhatsApp send blocked pending the runtime-send DevTools capture " +
          "(.scratch/bird-runtime-send-capture.txt). Receiver shape (layer 6) and template body shape " +
          "(layer 9) must be reconciled against the capture before flipping BIRD_RUNTIME_SEND_VERIFIED. " +
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

    // WhatsApp template payload: template name + locale + components.
    const templateName =
      readString(audience as Record<string, unknown>, "template_name") ?? null;
    const locale =
      readString(audience as Record<string, unknown>, "locale") ?? "en";

    const renderedBody = substituteTemplateVariables(
      message.bodyMarkdown,
      variables,
    );

    const body: Record<string, unknown> = {
      receiver: listId
        ? { contacts: { listId } }
        : { contacts: recipients.map((id) => ({ identifierValue: id })) },
      body:
        message.channel === "whatsapp" && templateName
          ? {
              type: "template",
              template: {
                name: templateName,
                locale,
                // Bird "components" carry the template variable bindings.
                components: Object.entries(variables).map(([key, value]) => ({
                  type: "body",
                  parameters: [{ type: "text", key, value }],
                })),
              },
            }
          : {
              type: "text",
              text: { text: renderedBody },
            },
    };

    try {
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
