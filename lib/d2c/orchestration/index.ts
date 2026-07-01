/**
 * lib/d2c/orchestration/index.ts
 *
 * Job-type-aware D2C send orchestration. Maps a scheduled send (event +
 * job_type + channel) to a concrete provider action and executes it — or,
 * under the 3-of-3 dry-run gate, describes what it *would* do without any
 * network side effect.
 *
 * 3-of-3 gate (shared with every provider): FEATURE_D2C_LIVE (env) AND
 * connection.live_enabled AND connection.approved_by_matas. If any is off the
 * job is dry-run only.
 *
 * The executors touch external APIs strictly through the typed clients
 * (lib/d2c/mailchimp/templates/client.ts, lib/d2c/bird/...). No ad-hoc fetch.
 */

import { shouldD2CDryRun, type D2CJobType } from "../types.ts";
import { buildEventTag } from "./tags.ts";
import type { MailchimpClientConfig } from "../mailchimp/templates/client.ts";
import type { BirdTemplateClientConfig } from "../bird/templates/client.ts";

export type OrchestrationProvider = "mailchimp" | "bird";

/** Canonical channel each job type sends on when a single row is scheduled. */
export const JOB_PRIMARY_CHANNEL: Record<D2CJobType, "email" | "whatsapp"> = {
  announce: "email",
  reminder: "email",
  presale_live: "email",
  gen_sale: "email",
  autoresp_setup: "email",
  community_early: "whatsapp",
};

/** Job types Mailchimp (email) can service. */
export const MAILCHIMP_JOB_TYPES: readonly D2CJobType[] = [
  "announce",
  "reminder",
  "presale_live",
  "gen_sale",
  "autoresp_setup",
];

/** Job types Bird (WhatsApp) can service. */
export const BIRD_JOB_TYPES: readonly D2CJobType[] = [
  "autoresp_setup",
  "reminder",
  "presale_live",
  "community_early",
];

export function providerForChannel(channel: string): OrchestrationProvider {
  return channel === "whatsapp" || channel === "sms" ? "bird" : "mailchimp";
}

export interface OrchestrationInput {
  jobType: D2CJobType;
  channel: string;
  brand: string;
  eventCode: string;
  connection: { id: string; live_enabled: boolean; approved_by_matas: boolean };
  /** Resolved event variables (EVENT_NAME, TICKET_URL, community_url, …). */
  variables: Record<string, string>;
  /** ISO time the send should fire. */
  scheduleTimeIso: string;
  mailchimp?: {
    templateName: string;
    audienceName?: string;
    listId?: string;
    fromName?: string;
    replyTo?: string;
    subject?: string;
  };
  bird?: {
    projectId: string;
    templateId: string;
    /** platformInfo status — must be 'active' for a live send. */
    templateStatus?: string;
    channelId?: string;
  };
}

export interface OrchestrationPlan {
  provider: OrchestrationProvider;
  jobType: D2CJobType;
  action: "campaign" | "automation" | "message";
  tag: string;
  scheduleTimeIso: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface OrchestrationResult {
  ok: boolean;
  dryRun: boolean;
  jobType: D2CJobType;
  provider: OrchestrationProvider;
  tag: string;
  plan: OrchestrationPlan;
  providerJobId?: string | null;
  error?: string;
}

export interface OrchestrationDeps {
  mailchimp?: MailchimpClientConfig;
  bird?: BirdTemplateClientConfig & { workspaceId: string };
}

/**
 * Pure planner: describe the action for a job without executing it. Safe to
 * call anywhere (tests, dry-run logging). No network.
 */
export function planJob(input: OrchestrationInput): OrchestrationPlan {
  const tag = buildEventTag(input.brand, input.eventCode);
  const provider = providerForChannel(input.channel);
  const ev = input.variables.EVENT_NAME ?? input.variables.event_name ?? input.eventCode;

  if (provider === "mailchimp") {
    if (input.jobType === "autoresp_setup") {
      return {
        provider,
        jobType: input.jobType,
        action: "automation",
        tag,
        scheduleTimeIso: input.scheduleTimeIso,
        summary: `would create Mailchimp classic automation for tag "${tag}" (template ${input.mailchimp?.templateName ?? "?"}), fires on subscriber tagged`,
        details: {
          templateName: input.mailchimp?.templateName,
          audienceName: input.mailchimp?.audienceName,
          trigger: "subscriber-added-with-tag",
        },
      };
    }
    const subject = input.mailchimp?.subject ?? `${ev}`;
    return {
      provider,
      jobType: input.jobType,
      action: "campaign",
      tag,
      scheduleTimeIso: input.scheduleTimeIso,
      summary: `would create Mailchimp campaign "${subject}" → segment tag "${tag}" (template ${input.mailchimp?.templateName ?? "?"}), schedule ${input.scheduleTimeIso}`,
      details: {
        subject,
        templateName: input.mailchimp?.templateName,
        audienceName: input.mailchimp?.audienceName,
        segmentTag: tag,
      },
    };
  }

  // Bird / WhatsApp
  return {
    provider,
    jobType: input.jobType,
    action: "message",
    tag,
    scheduleTimeIso: input.scheduleTimeIso,
    summary: `would send Bird WhatsApp template ${input.bird?.templateId ?? "?"} (project ${input.bird?.projectId ?? "?"}) to tag "${tag}", scheduledFor ${input.scheduleTimeIso}`,
    details: {
      projectId: input.bird?.projectId,
      templateId: input.bird?.templateId,
      templateStatus: input.bird?.templateStatus,
      segmentTag: tag,
    },
  };
}

/**
 * Dispatch a single scheduled job. Honours the 3-of-3 gate: if any gate is off
 * the job is planned + logged but never executed (dryRun=true). Live execution
 * goes through the typed clients (deps required).
 */
export async function orchestrateJob(
  input: OrchestrationInput,
  deps: OrchestrationDeps = {},
): Promise<OrchestrationResult> {
  const plan = planJob(input);
  const dryRun = shouldD2CDryRun(input.connection);

  if (dryRun) {
    console.warn(
      `[DRY RUN] d2c orchestrate provider=${plan.provider} job=${plan.jobType} tag=${plan.tag} :: ${plan.summary}`,
    );
    return { ok: true, dryRun: true, jobType: input.jobType, provider: plan.provider, tag: plan.tag, plan };
  }

  try {
    if (plan.provider === "mailchimp") {
      if (!deps.mailchimp) throw new Error("mailchimp client config required for live send");
      const { executeMailchimpJob } = await import("./mailchimp-runner.ts");
      const jobId = await executeMailchimpJob(deps.mailchimp, input, plan);
      return { ok: true, dryRun: false, jobType: input.jobType, provider: plan.provider, tag: plan.tag, plan, providerJobId: jobId };
    }

    if (!deps.bird) throw new Error("bird client config required for live send");
    // Live WhatsApp sends require a Meta-approved (active) template.
    if (input.bird?.templateStatus && input.bird.templateStatus !== "active") {
      throw new Error(`bird template ${input.bird.templateId} not active (status=${input.bird.templateStatus}) — refusing live send`);
    }
    const { executeBirdJob } = await import("./bird-runner.ts");
    const jobId = await executeBirdJob(deps.bird, input, plan);
    return { ok: true, dryRun: false, jobType: input.jobType, provider: plan.provider, tag: plan.tag, plan, providerJobId: jobId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[d2c orchestrate] live send failed provider=${plan.provider} job=${plan.jobType}:`, error);
    return { ok: false, dryRun: false, jobType: input.jobType, provider: plan.provider, tag: plan.tag, plan, error };
  }
}
