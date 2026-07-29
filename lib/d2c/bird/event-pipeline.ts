/**
 * lib/d2c/bird/event-pipeline.ts
 *
 * One event's facts → WhatsApp template drafts + scheduled broadcast drafts.
 *
 * This is the piece that turns "a new event means hand-writing a definitions
 * file" into "a brief is the input". It composes existing parts rather than
 * introducing a parallel path:
 *
 *   templates/from-event.ts   facts   → definitions        (pure)
 *   templates/runner.ts       defs    → Bird template DRAFTS
 *   campaigns/client.ts       template → campaign + broadcast DRAFT
 *   campaigns/schedule.ts     wall clock + IANA zone → a schedule Bird accepts
 *
 * ── Safety invariants, all load-bearing ────────────────────────────────────
 *
 *  1. **Nothing is ever activated.** Templates are created as drafts and
 *     `submit` is never passed through. Submitting to Meta publishes under a
 *     live client WABA and stays a human decision.
 *  2. **Nothing is ever fired.** Broadcasts are created as drafts with NO
 *     audience. Bird itself blocks activation while `_issues` reports
 *     "Included recipients must be provided", so a draft physically cannot
 *     send. A human attaches the audience, proof-tests, and sends.
 *  3. **Idempotent on template name.** Names are deterministic per
 *     (brand, event, milestone, locale); campaign names are deterministic per
 *     (template name, date). Re-running a brief converges instead of
 *     duplicating.
 *  4. **Nothing is ever deleted.** Bird deletes are global — a contact delete
 *     once removed a person from all 17 lists. There is no delete path here.
 */

import {
  createDraftCampaign,
  type CreateDraftCampaignResult,
} from "./campaigns/client.ts";
import { scheduledBroadcastSchedule } from "./campaigns/schedule.ts";
import type { BirdTemplateClientConfig } from "./templates/client.ts";
import { findProjectByName, findTemplateByName } from "./templates/client.ts";
import {
  buildEventTemplateDefinitions,
  eventTemplateName,
  WHATSAPP_MILESTONES,
  type EventTemplateInput,
  type WhatsappMilestone,
} from "./templates/from-event.ts";
import { shipTemplateDefinitions, type TemplateResult } from "./templates/runner.ts";

/** Venue-local wall-clock send time for one milestone. */
export interface MilestoneSchedule {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface EventPipelineInput {
  event: EventTemplateInput;
  /** IANA zone for every schedule, e.g. "Europe/Lisbon". Never an offset. */
  timezone: string;
  /** WABA channel group id — makes the created drafts submit-ready. */
  channelGroupId: string;
  /** WhatsApp channel id the broadcast sends from. */
  channelId: string;
  /**
   * Send times per milestone. A milestone with no entry still gets a template
   * draft but no broadcast (e.g. the signup autoresponder, which is triggered
   * by a journey rather than scheduled).
   */
  schedules: Partial<Record<WhatsappMilestone, MilestoneSchedule>>;
  /** Restrict the run; defaults to every WhatsApp milestone. */
  milestones?: readonly WhatsappMilestone[];
  /** Plan only — no writes at all. */
  dryRun?: boolean;
}

export interface MilestoneOutcome {
  milestone: WhatsappMilestone;
  templateName: string;
  template: TemplateResult | null;
  campaign: (CreateDraftCampaignResult & { name: string }) | null;
  /** Why no broadcast was created, when none was. */
  broadcastSkippedReason?: string;
}

export interface EventPipelineReport {
  dryRun: boolean;
  outcomes: MilestoneOutcome[];
}

/** Deterministic campaign name: template name + the send date it carries. */
export function eventCampaignName(templateName: string, s: MilestoneSchedule): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${templateName}_${s.year}${p(s.month)}${p(s.day)}`;
}

/**
 * Resolve the Bird ids a broadcast needs to reference a template. The shipper
 * reports these on a create, but on an idempotent skip we must look them up —
 * otherwise a re-run would silently produce a broadcast pointing at nothing.
 */
async function resolveTemplateRef(
  cfg: BirdTemplateClientConfig,
  templateName: string,
): Promise<{ projectId: string; projectVersionId: string } | null> {
  const project = await findProjectByName(cfg, templateName);
  if (!project) return null;
  const tpl = await findTemplateByName(cfg, project.id, templateName);
  if (!tpl) return null;
  return { projectId: project.id, projectVersionId: tpl.id };
}

/**
 * Run the pipeline for one event. Returns a structured report; the caller
 * renders it (CLI, route handler, or the brief processor).
 */
export async function runEventWhatsappPipeline(
  cfg: BirdTemplateClientConfig,
  input: EventPipelineInput,
): Promise<EventPipelineReport> {
  const milestones = input.milestones ?? WHATSAPP_MILESTONES;
  const dryRun = input.dryRun ?? false;

  const definitions = buildEventTemplateDefinitions(input.event, milestones);

  // 1. Template drafts. `submit` is deliberately NOT forwarded — see invariant 1.
  const shipReport = await shipTemplateDefinitions(cfg, definitions, {
    brand: `${input.event.brand}_${input.event.eventSlug}`,
    channelGroupId: input.channelGroupId,
    dryRun,
  });

  const outcomes: MilestoneOutcome[] = [];

  for (const milestone of milestones) {
    const templateName = eventTemplateName(input.event, milestone);
    const template = shipReport.results.find((r) => r.name === templateName) ?? null;
    const schedule = input.schedules[milestone];

    if (!schedule) {
      outcomes.push({
        milestone,
        templateName,
        template,
        campaign: null,
        broadcastSkippedReason: "no send time for this milestone (not a scheduled broadcast)",
      });
      continue;
    }

    if (dryRun) {
      outcomes.push({
        milestone,
        templateName,
        template,
        campaign: null,
        broadcastSkippedReason: "dry run",
      });
      continue;
    }

    if (template?.outcome === "error") {
      outcomes.push({
        milestone,
        templateName,
        template,
        campaign: null,
        broadcastSkippedReason: `template failed to ship: ${template.error ?? "unknown"}`,
      });
      continue;
    }

    // On a create the shipper gives us the ids; on an idempotent skip it gives
    // the template id but the project id too — fall back to a lookup either way
    // so a re-run cannot point a broadcast at a stale/absent template.
    const ref =
      template?.projectId && template?.templateId
        ? { projectId: template.projectId, projectVersionId: template.templateId }
        : await resolveTemplateRef(cfg, templateName);

    if (!ref) {
      outcomes.push({
        milestone,
        templateName,
        template,
        campaign: null,
        broadcastSkippedReason: "could not resolve the shipped template in Bird",
      });
      continue;
    }

    const name = eventCampaignName(templateName, schedule);
    const campaign = await createDraftCampaign({
      workspaceId: cfg.workspaceId,
      channelId: input.channelId,
      projectId: ref.projectId,
      projectVersionId: ref.projectVersionId,
      name,
      defaultLocale: input.event.locale,
      variables: {}, // single-event templates declare none
      schedule: scheduledBroadcastSchedule({ ...schedule, timezone: input.timezone }),
      // recipients deliberately omitted — see invariant 2.
    });

    outcomes.push({ milestone, templateName, template, campaign: { ...campaign, name } });
  }

  return { dryRun, outcomes };
}
