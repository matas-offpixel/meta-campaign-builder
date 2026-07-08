/**
 * lib/d2c/mailchimp/provider.ts
 *
 * Mailchimp Marketing API — API key + server prefix (Phase 1).
 * TODO(Phase 2): OAuth2 — replace key entry with OAuth flow and refresh tokens.
 */

import { performDryRun } from "../dry-run.ts";
import { mailchimpFetch, mailchimpJson } from "./client.ts";
import {
  buildSegmentOpts,
  getAudienceTags,
  resolveAudienceTags,
  resolveMailchimpListId,
  type SegmentOpts,
} from "../audience/tag-registry.ts";
import { renderD2CEmailHtml } from "../render/email-html.ts";
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

/**
 * Resolve an audience's tag names → a Mailchimp `segment_opts` (match "any")
 * for a multi-tag send (Goal 5). Back-compat: `audience.tags[]` if present,
 * else `[audience.tag]`. A single tag still produces a one-condition
 * segment_opts (Mailchimp accepts it, keeping the code path uniform). Returns
 * null when there is no tag at all (send to the whole list). Throws an
 * actionable error when a named tag can't be resolved to a segment id — never
 * silently drops a tag (per spec).
 */
export async function resolveSegmentOpts(
  serverPrefix: string,
  apiKey: string,
  listId: string,
  audience: Record<string, unknown>,
): Promise<SegmentOpts | null> {
  const tags = resolveAudienceTags(audience);
  if (tags.length === 0) return null;

  const allTags = await getAudienceTags(serverPrefix, apiKey, listId);
  const byExact: Record<string, number> = {};
  const byLower: Record<string, number> = {};
  for (const t of allTags) {
    byExact[t.name] = t.id;
    byLower[t.name.toLowerCase()] = t.id;
  }
  const idMap: Record<string, number> = {};
  for (const tag of tags) {
    const id = byExact[tag] ?? byLower[tag.toLowerCase()];
    if (typeof id !== "number") {
      throw new Error(`Tag "${tag}" not found in audience ${listId}`);
    }
    idMap[tag] = id;
  }
  return buildSegmentOpts(idMap, tags);
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

/**
 * The actual campaign create → content → send/schedule sequence, with NO
 * gate check. Extracted from `MailchimpProvider.send` so callers that must
 * bypass the 3-of-3 live gate by design (operator "send test to me" — always
 * fires live to the operator's own inbox, never a dry run) can invoke it
 * directly. `MailchimpProvider.send` remains the gated entry point for every
 * other caller (cron, autoresponder fire, backfill).
 */
export async function sendMailchimpCampaignLive(
  connection: D2CConnection,
  message: D2CMessage,
): Promise<SendResult> {
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
  // Bug C fix (2026-07-08): read both key conventions in use across the
  // codebase — historical rows carry audience_id, PR #696's tag picker and
  // its PATCH route write list_id. See FLAG note in the PR body re:
  // canonicalising the WRITE path (tracked as a separate follow-up).
  const listId = resolveMailchimpListId(audience) ?? "";
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

  // Bug D fix (2026-07-08): render the SAME branded chassis (hero artwork,
  // dark background, CTA button) the dashboard preview shows — this
  // previously shipped bare markdownToBasicHtml(bodyMd), which stripped
  // every visual element, so every real/test send arrived as a plain-ish
  // email regardless of what the preview showed. `subject` here is the
  // IN-BODY eyebrow line (substituted internally, matches the preview);
  // Mailchimp's own `settings.subject_line` above stays the raw template
  // subject — substituting THAT is a separate, pre-existing gap outside
  // this fix's scope (see PR body).
  const variablesMap = Object.fromEntries(
    Object.entries(message.variables ?? {}).map(([k, v]) => [
      k,
      v === null || v === undefined ? "" : String(v),
    ]),
  );
  const html = renderD2CEmailHtml({
    subject: message.subject ?? null,
    bodyMarkdown: message.bodyMarkdown,
    variables: variablesMap,
    artworkUrl: message.artworkUrl ?? null,
    eventName: message.eventName ?? "",
    buttonLabel: message.buttonLabel ?? null,
    buttonUrl: message.buttonUrl ?? null,
    themeColor: message.themeColor ?? undefined,
  });

  const title =
    (typeof audience.campaign_title === "string" &&
    audience.campaign_title.trim()
      ? audience.campaign_title.trim()
      : null) ?? `d2c-${message.correlationId ?? "send"}`;

  // Single-member autoresponder / test-send path: the caller has already
  // resolved the recipient into an ephemeral static segment and passes its
  // numeric id. Target it directly and skip tag resolution entirely.
  const savedSegmentId =
    typeof audience.saved_segment_id === "number"
      ? audience.saved_segment_id
      : null;

  let recipients: Record<string, unknown>;
  if (savedSegmentId != null) {
    recipients = {
      list_id: listId,
      segment_opts: { saved_segment_id: savedSegmentId },
    };
  } else {
    let segmentOpts: SegmentOpts | null;
    try {
      segmentOpts = await resolveSegmentOpts(serverPrefix, apiKey, listId, audience);
    } catch (e) {
      return {
        ok: false,
        dryRun: false,
        error: e instanceof Error ? e.message : "Tag resolution failed",
      };
    }
    recipients = segmentOpts
      ? { list_id: listId, segment_opts: segmentOpts }
      : { list_id: listId };
  }

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
          recipients,
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

    // Single-recipient fires (autoresponder / test-send) send immediately —
    // Mailchimp's schedule endpoint only accepts future 15-min increments, so
    // an "immediate" schedule would 400. `audience.send_now` skips straight to
    // the send action.
    const sendNowRequested = audience.send_now === true;
    const scheduleIso =
      typeof audience.schedule_time === "string" && audience.schedule_time
        ? audience.schedule_time
        : new Date().toISOString();

    let schedulePayload: unknown;
    if (sendNowRequested) {
      schedulePayload = {
        action: "send",
        sendNow: await mailchimpJson<unknown>(
          serverPrefix,
          apiKey,
          `/3.0/campaigns/${campaignId}/actions/send`,
          { method: "POST" },
        ),
      };
    } else {
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
    return sendMailchimpCampaignLive(connection, message);
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
