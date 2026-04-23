/**
 * lib/d2c/mailchimp/provider.ts
 *
 * Mailchimp Marketing API — API key + server prefix (Phase 1).
 * TODO(Phase 2): OAuth2 — replace key entry with OAuth flow and refresh tokens.
 */

import { performDryRun } from "../dry-run.ts";
import { mailchimpFetch, mailchimpJson } from "./client.ts";
import {
  markdownToBasicHtml,
  substituteTemplateVariables,
} from "../event-variables.ts";
import {
  isD2CLiveEnabled,
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

export function mailchimpDryRunGatesBlockLiveSend(connection: D2CConnection): {
  featureOff: boolean;
  liveDisabled: boolean;
  notMatasApproved: boolean;
} {
  return {
    featureOff: !isD2CLiveEnabled(),
    liveDisabled: !connection.live_enabled,
    notMatasApproved: !connection.approved_by_matas,
  };
}

function shouldMailchimpDryRun(connection: D2CConnection): boolean {
  const g = mailchimpDryRunGatesBlockLiveSend(connection);
  return g.featureOff || g.liveDisabled || g.notMatasApproved;
}

export class MailchimpProvider implements D2CProvider {
  readonly name = "mailchimp" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateD2CCredentialsResult> {
    const apiKey = readString(credentials, "api_key");
    const serverPrefix = readString(credentials, "server_prefix");
    if (!apiKey || !serverPrefix) {
      return { ok: false, error: "api_key and server_prefix are required." };
    }
    try {
      await mailchimpJson<unknown>(serverPrefix, apiKey, "/3.0/ping", {
        method: "GET",
      });
      return { ok: true, externalAccountId: serverPrefix };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Mailchimp ping failed.";
      return { ok: false, error: msg };
    }
  }

  async send(
    connection: D2CConnection,
    message: D2CMessage,
  ): Promise<SendResult> {
    if (shouldMailchimpDryRun(connection)) {
      return performDryRun(this.name, message);
    }

    const creds =
      connection.credentials && typeof connection.credentials === "object"
        ? (connection.credentials as Record<string, unknown>)
        : {};
    const apiKey = readString(creds, "api_key");
    const serverPrefix = readString(creds, "server_prefix");
    if (!apiKey || !serverPrefix) {
      return {
        ok: false,
        dryRun: false,
        error: "Missing Mailchimp api_key or server_prefix on connection.",
      };
    }

    const audience = message.audience ?? {};
    const listId =
      typeof audience.list_id === "string" ? audience.list_id.trim() : "";
    const fromName =
      typeof audience.from_name === "string" && audience.from_name.trim()
        ? audience.from_name.trim()
        : "Events";
    const replyTo =
      typeof audience.reply_to === "string" && audience.reply_to.trim()
        ? audience.reply_to.trim()
        : null;
    if (!listId) {
      return {
        ok: false,
        dryRun: false,
        error: "audience.list_id is required for Mailchimp sends.",
      };
    }
    if (!replyTo) {
      return {
        ok: false,
        dryRun: false,
        error: "audience.reply_to is required for Mailchimp sends.",
      };
    }

    const subject =
      typeof message.subject === "string" && message.subject.trim()
        ? message.subject.trim()
        : "(no subject)";

    const bodyMd = substituteTemplateVariables(
      message.bodyMarkdown,
      Object.fromEntries(
        Object.entries(message.variables ?? {}).map(([k, v]) => [
          k,
          v === null || v === undefined ? "" : String(v),
        ]),
      ),
    );
    const html = markdownToBasicHtml(bodyMd);

    const title =
      (typeof audience.campaign_title === "string" &&
      audience.campaign_title.trim()
        ? audience.campaign_title.trim()
        : null) ?? `d2c-${message.correlationId ?? "send"}`;

    try {
      const created = await mailchimpJson<{ id: string }>(
        serverPrefix,
        apiKey,
        "/3.0/campaigns",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "regular",
            recipients: { list_id: listId },
            settings: {
              subject_line: subject,
              title,
              from_name: fromName,
              reply_to: replyTo,
            },
          }),
        },
      );

      const campaignId = created.id;
      if (!campaignId) {
        return {
          ok: false,
          dryRun: false,
          error: "Mailchimp did not return a campaign id.",
        };
      }

      const contentRes = await mailchimpJson<unknown>(
        serverPrefix,
        apiKey,
        `/3.0/campaigns/${campaignId}/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html }),
        },
      );

      const scheduleIso =
        typeof audience.schedule_time === "string" && audience.schedule_time
          ? audience.schedule_time
          : new Date().toISOString();

      let schedulePayload: unknown;
      try {
        schedulePayload = await mailchimpJson<unknown>(
          serverPrefix,
          apiKey,
          `/3.0/campaigns/${campaignId}/actions/schedule`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ schedule_time: scheduleIso }),
          },
        );
      } catch (schedErr) {
        const sendNow = await mailchimpJson<unknown>(
          serverPrefix,
          apiKey,
          `/3.0/campaigns/${campaignId}/actions/send`,
          { method: "POST" },
        );
        schedulePayload = { fallback: "send", sendNow, schedule_error:
          schedErr instanceof Error ? schedErr.message : String(schedErr) };
      }

      return {
        ok: true,
        dryRun: false,
        providerJobId: campaignId,
        details: {
          campaign: created,
          content: contentRes,
          schedule: schedulePayload,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Mailchimp send failed.";
      return { ok: false, dryRun: false, error: msg };
    }
  }
}

export const mailchimpProvider = new MailchimpProvider();

export async function mailchimpPingStatus(
  serverPrefix: string,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const res = await mailchimpFetch(serverPrefix, apiKey, "/3.0/ping", {
    method: "GET",
  });
  const body = await res.text();
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, body };
}
