/**
 * lib/d2c/orchestration/mailchimp-runner.ts
 *
 * Live executor for Mailchimp orchestration jobs. Only reached when the
 * 3-of-3 gate is satisfied (see orchestrateJob). All calls go through the
 * typed templates client.
 */

import {
  createCampaign,
  createClassicAutomation,
  findTemplateByName,
  resolveAudienceByName,
  resolveSegmentByTag,
  scheduleCampaign,
  setCampaignContent,
  type MailchimpClientConfig,
} from "../mailchimp/templates/client.ts";
import type { OrchestrationInput, OrchestrationPlan } from "./index.ts";

async function resolveListId(cfg: MailchimpClientConfig, input: OrchestrationInput): Promise<string> {
  if (input.mailchimp?.listId) return input.mailchimp.listId;
  if (input.mailchimp?.audienceName) {
    const aud = await resolveAudienceByName(cfg, input.mailchimp.audienceName);
    if (aud) return aud.id;
  }
  throw new Error("mailchimp: could not resolve audience list_id (provide listId or audienceName)");
}

/** Returns the created campaign/automation id. Throws on any failure (logged upstream). */
export async function executeMailchimpJob(
  cfg: MailchimpClientConfig,
  input: OrchestrationInput,
  plan: OrchestrationPlan,
): Promise<string> {
  const templateName = input.mailchimp?.templateName;
  if (!templateName) throw new Error("mailchimp: templateName required");
  const template = await findTemplateByName(cfg, templateName);
  if (!template) throw new Error(`mailchimp: template "${templateName}" not found in account`);

  const fromName = input.mailchimp?.fromName ?? input.brand;
  const replyTo = input.mailchimp?.replyTo;
  if (!replyTo) throw new Error("mailchimp: replyTo required for live send");

  const listId = await resolveListId(cfg, input);

  if (plan.action === "automation") {
    const auto = await createClassicAutomation(cfg, {
      listId,
      title: `${input.brand} ${input.eventCode} autoresponder`,
      fromName,
      replyTo,
    });
    return auto.id;
  }

  // Campaign path: create → set content from template → schedule to tag segment.
  const seg = await resolveSegmentByTag(cfg, listId, plan.tag);
  const campaign = await createCampaign(cfg, {
    listId,
    segmentId: seg?.id,
    subject: (plan.details.subject as string) ?? templateName,
    title: `${input.brand} ${input.eventCode} ${input.jobType}`,
    fromName,
    replyTo,
  });
  await setCampaignContent(cfg, campaign.id, { template: { id: template.id } });
  await scheduleCampaign(cfg, campaign.id, input.scheduleTimeIso);
  return campaign.id;
}
