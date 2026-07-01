/**
 * lib/d2c/mailchimp/templates/client.ts
 *
 * Typed Mailchimp Marketing API v3 client for templates, campaigns,
 * automations, audiences and segments. Built on the shared
 * `mailchimpJson` helper (Basic auth, 20s timeout, one 5xx retry) —
 * no ad-hoc fetch. All non-2xx throw MailchimpHttpError (full body logged
 * by callers).
 *
 * Docs: https://mailchimp.com/developer/marketing/api/
 */

import { mailchimpJson } from "../client.ts";
import type {
  MailchimpAudience,
  MailchimpAudienceList,
  MailchimpAutomation,
  MailchimpAutomationList,
  MailchimpCampaign,
  MailchimpSegment,
  MailchimpSegmentList,
  MailchimpTemplate,
  MailchimpTemplateList,
} from "./types.ts";

export interface MailchimpClientConfig {
  serverPrefix: string;
  apiKey: string;
}

function json<T>(
  cfg: MailchimpClientConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return mailchimpJson<T>(cfg.serverPrefix, cfg.apiKey, path, init);
}

function body(payload: unknown, method: string): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

// ─── Templates ──────────────────────────────────────────────────────────────

export function createTemplate(
  cfg: MailchimpClientConfig,
  input: { name: string; html: string; folder_id?: string },
): Promise<MailchimpTemplate> {
  return json<MailchimpTemplate>(cfg, "/3.0/templates", body(input, "POST"));
}

export function getTemplate(
  cfg: MailchimpClientConfig,
  templateId: number | string,
): Promise<MailchimpTemplate> {
  return json<MailchimpTemplate>(cfg, `/3.0/templates/${templateId}`, { method: "GET" });
}

export async function listTemplates(
  cfg: MailchimpClientConfig,
  opts: { count?: number; type?: string } = {},
): Promise<MailchimpTemplate[]> {
  const count = Math.min(opts.count ?? 1000, 1000);
  const type = opts.type ? `&type=${encodeURIComponent(opts.type)}` : "";
  const res = await json<MailchimpTemplateList>(
    cfg,
    `/3.0/templates?count=${count}${type}`,
    { method: "GET" },
  );
  return res.templates ?? [];
}

export function updateTemplate(
  cfg: MailchimpClientConfig,
  templateId: number | string,
  patch: { name?: string; html?: string },
): Promise<MailchimpTemplate> {
  return json<MailchimpTemplate>(cfg, `/3.0/templates/${templateId}`, body(patch, "PATCH"));
}

export async function deleteTemplate(
  cfg: MailchimpClientConfig,
  templateId: number | string,
): Promise<void> {
  await json<unknown>(cfg, `/3.0/templates/${templateId}`, { method: "DELETE" });
}

/** Idempotency helper: find a user template by exact name. */
export async function findTemplateByName(
  cfg: MailchimpClientConfig,
  name: string,
): Promise<MailchimpTemplate | null> {
  const list = await listTemplates(cfg, { type: "user" });
  return list.find((t) => t.name === name) ?? null;
}

// ─── Campaigns ────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  listId: string;
  segmentId?: number;
  subject: string;
  title: string;
  fromName: string;
  replyTo: string;
  previewText?: string;
}

export function createCampaign(
  cfg: MailchimpClientConfig,
  input: CreateCampaignInput,
): Promise<MailchimpCampaign> {
  const recipients: Record<string, unknown> = { list_id: input.listId };
  if (input.segmentId != null) {
    recipients.segment_opts = { saved_segment_id: input.segmentId };
  }
  return json<MailchimpCampaign>(
    cfg,
    "/3.0/campaigns",
    body(
      {
        type: "regular",
        recipients,
        settings: {
          subject_line: input.subject,
          preview_text: input.previewText,
          title: input.title,
          from_name: input.fromName,
          reply_to: input.replyTo,
          auto_footer: false,
        },
      },
      "POST",
    ),
  );
}

/** Set campaign content — either raw html or a stored template id. */
export function setCampaignContent(
  cfg: MailchimpClientConfig,
  campaignId: string,
  content: { html: string } | { template: { id: number } },
): Promise<unknown> {
  return json<unknown>(
    cfg,
    `/3.0/campaigns/${campaignId}/content`,
    body(content, "PUT"),
  );
}

export function scheduleCampaign(
  cfg: MailchimpClientConfig,
  campaignId: string,
  scheduleTimeIso: string,
): Promise<unknown> {
  return json<unknown>(
    cfg,
    `/3.0/campaigns/${campaignId}/actions/schedule`,
    body({ schedule_time: scheduleTimeIso }, "POST"),
  );
}

export function sendCampaign(
  cfg: MailchimpClientConfig,
  campaignId: string,
): Promise<unknown> {
  return json<unknown>(
    cfg,
    `/3.0/campaigns/${campaignId}/actions/send`,
    { method: "POST" },
  );
}

// ─── Automations (classic) ──────────────────────────────────────────────────

export async function listAutomations(
  cfg: MailchimpClientConfig,
): Promise<MailchimpAutomation[]> {
  const res = await json<MailchimpAutomationList>(cfg, "/3.0/automations?count=1000", {
    method: "GET",
  });
  return res.automations ?? [];
}

/**
 * Create a classic automation triggered when a subscriber is added to a list.
 * Mailchimp's classic automations are being sunset in favour of Customer
 * Journeys (no public create endpoint), so this remains the documented path.
 * The workflow emails themselves are configured after creation.
 */
export function createClassicAutomation(
  cfg: MailchimpClientConfig,
  input: {
    listId: string;
    title: string;
    fromName: string;
    replyTo: string;
  },
): Promise<MailchimpAutomation> {
  return json<MailchimpAutomation>(
    cfg,
    "/3.0/automations",
    body(
      {
        recipients: { list_id: input.listId },
        trigger_settings: { workflow_type: "emailSeries" },
        settings: {
          title: input.title,
          from_name: input.fromName,
          reply_to: input.replyTo,
        },
      },
      "POST",
    ),
  );
}

// ─── Audiences + segments ───────────────────────────────────────────────────

export async function listAudiences(
  cfg: MailchimpClientConfig,
): Promise<MailchimpAudience[]> {
  const res = await json<MailchimpAudienceList>(cfg, "/3.0/lists?count=1000", {
    method: "GET",
  });
  return res.lists ?? [];
}

export async function listSegments(
  cfg: MailchimpClientConfig,
  audienceId: string,
): Promise<MailchimpSegment[]> {
  const res = await json<MailchimpSegmentList>(
    cfg,
    `/3.0/lists/${audienceId}/segments?count=1000`,
    { method: "GET" },
  );
  return res.segments ?? [];
}

export async function resolveAudienceByName(
  cfg: MailchimpClientConfig,
  audienceName: string,
): Promise<MailchimpAudience | null> {
  const lists = await listAudiences(cfg);
  const lc = audienceName.trim().toLowerCase();
  return lists.find((l) => l.name.trim().toLowerCase() === lc) ?? null;
}

/**
 * Resolve a static segment by its name (the tag). Mailchimp surfaces tags as
 * static segments; the tag string is the segment name. Returns null if no
 * segment matches — caller decides whether to create one.
 */
export async function resolveSegmentByTag(
  cfg: MailchimpClientConfig,
  audienceId: string,
  tag: string,
): Promise<MailchimpSegment | null> {
  const segs = await listSegments(cfg, audienceId);
  const lc = tag.trim().toLowerCase();
  return segs.find((s) => s.name.trim().toLowerCase() === lc) ?? null;
}
