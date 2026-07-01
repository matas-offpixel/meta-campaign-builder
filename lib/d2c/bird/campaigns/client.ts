/**
 * lib/d2c/bird/campaigns/client.ts
 *
 * Typed client for Bird's broadcast **campaign** API — creates review-first
 * DRAFT campaigns that Matas reviews, adds audiences to, proof-tests and fires
 * manually in the Bird UI.
 *
 * ✅ VERIFIED against `.scratch/bird-campaign-draft-capture.txt` (2026-07-01).
 * Bird's create flow is a **nested three-call sequence**, NOT one flat POST:
 *
 *   1. POST  /workspaces/{wid}/campaigns                        → { id: campaignId }
 *   2. POST  /workspaces/{wid}/campaigns/{cid}/broadcasts       → { id: broadcastId }
 *   3. PATCH /workspaces/{wid}/campaigns/{cid}/broadcasts/{bid} → full config body
 *
 * The PATCH body mirrors the broadcast GET response (capture §4) minus the
 * server-computed fields (_issues / counters / changelog / id / createdAt /
 * updatedAt). Content is a `channel_template` referencing projectId +
 * projectVersionId + a variables map; recipients use typed { type, id } refs.
 *
 * Auth: server AccessKey (`BIRD_API_KEY`) — capture §I confirms it routes
 * identically to the SPA's Bearer JWT (`editorType:"accesskey"` on our resources).
 * Every non-2xx surfaces the full response body via BirdHttpError / console.error.
 */

import { BirdHttpError, birdFetch, birdJson } from "../client.ts";

/** Endpoint + payload shapes verified against the DevTools capture. */
export const DRAFT_CAMPAIGN_VERIFIED = true;

const APP_BASE = process.env.BIRD_APP_BASE?.trim() || "https://app.bird.com";

export interface BirdCampaignClientConfig {
  apiKey: string;
  workspaceId: string;
}

export interface BirdCampaign {
  id: string;
  name?: string;
  status?: string;
}

export interface BirdBroadcast {
  id: string;
  status?: string;
  schedule?: BroadcastSchedule;
}

export interface BroadcastSchedule {
  startsAt: string;
  timezone: string;
  timeInPastBehavior: string;
  missingTimeZoneBehavior: string;
}

export interface BroadcastRecipientRef {
  type: "group" | "list";
  id: string;
}

export interface BroadcastRecipients {
  include: BroadcastRecipientRef[];
  capFrequency?: boolean;
  holdoutPercentage?: number;
}

export interface CreateDraftCampaignInput {
  workspaceId: string;
  channelId: string;
  /** Stable template project id (capture: content.channelTemplate.projectId). */
  projectId: string;
  /** Template version id — bumps on edit (capture: content.channelTemplate.projectVersionId). */
  projectVersionId: string;
  name: string;
  defaultLocale: string;
  /** template var key → resolved value. Every template variable must be present. */
  variables: Record<string, string>;
  /**
   * Optional typed recipient refs. If omitted, Bird shows an empty recipient
   * list and Matas picks lists/segments in the UI. A Mailchimp-style tag string
   * is NOT a valid Bird recipient id — only resolved group/list UUIDs go here.
   */
  recipients?: BroadcastRecipients;
  /** AccessKey; defaults to BIRD_API_KEY env. */
  apiKey?: string;
}

export interface CreateDraftCampaignResult {
  campaignId: string;
  broadcastId: string | null;
  editUrl: string;
  status: string;
  /** true when this returned an existing campaign (idempotency skip). */
  existed: boolean;
}

/** Default broadcast schedule (capture §3 empty-draft shape). */
export function defaultBroadcastSchedule(nowIso = new Date().toISOString()): BroadcastSchedule {
  return {
    startsAt: nowIso,
    timezone: "recipient-local",
    timeInPastBehavior: "send-immediately",
    missingTimeZoneBehavior: "workspace-timezone",
  };
}

function campaignsPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/campaigns`;
}

function broadcastsPath(workspaceId: string, campaignId: string): string {
  return `${campaignsPath(workspaceId)}/${campaignId}/broadcasts`;
}

function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["results", "data", "campaigns", "broadcasts", "items"]) {
      if (Array.isArray(o[k])) return o[k] as T[];
    }
  }
  return [];
}

/** Top-level campaign edit URL for Matas manual review (capture §G). */
export function birdCampaignEditUrl(workspaceId: string, campaignId: string): string {
  return `${APP_BASE}/workspaces/${workspaceId}/campaigns/${campaignId}`;
}

/** Keep only non-empty string values (Bird rejects null/empty variable values). */
export function buildTemplateVariables(
  variables: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(variables)) {
    if (v != null && String(v) !== "") out[k] = String(v);
  }
  return out;
}

export interface BroadcastPatchInput {
  projectId: string;
  projectVersionId: string;
  defaultLocale: string;
  variables: Record<string, string>;
  channelId: string;
  schedule: BroadcastSchedule;
  recipients?: BroadcastRecipients;
}

/**
 * Build the PATCH body for a configured broadcast. Mirrors capture §4 minus the
 * server-computed fields. `content.channelTemplate.variables` is included only
 * when non-empty (matches the capture's unset state exactly when empty).
 */
export function buildBroadcastPatch(input: BroadcastPatchInput): Record<string, unknown> {
  const vars = buildTemplateVariables(input.variables);
  const channelTemplate: Record<string, unknown> = {
    projectId: input.projectId,
    projectVersionId: input.projectVersionId,
    defaultLocale: input.defaultLocale,
  };
  if (Object.keys(vars).length > 0) channelTemplate.variables = vars;

  const patch: Record<string, unknown> = {
    status: "draft",
    type: "channel",
    content: {
      type: "channel_template",
      channelTemplate,
    },
    channels: {
      platforms: [
        {
          platformId: "whatsapp",
          channelIds: null,
          navigatorId: null,
          channels: [{ id: input.channelId }],
          selection: "random",
        },
      ],
      prioritizeContactTimezone: false,
      prioritizeContactLocale: false,
    },
    schedule: input.schedule,
    tracking: { includeParameters: true },
    localeMatching: "user_locale_or_default",
    localeRules: { localeMatching: "user_locale_or_default" },
  };

  const include = input.recipients?.include ?? [];
  if (include.length > 0) {
    const first = include[0];
    patch.audience =
      first.type === "list"
        ? { type: "list", list: { listId: first.id }, frequencyCapEnabled: true }
        : { type: "group", group: { groupId: first.id }, frequencyCapEnabled: true };
    patch.recipients = {
      include: include.map((r) => ({ type: r.type, id: r.id })),
      capFrequency: input.recipients?.capFrequency ?? true,
      holdoutPercentage: input.recipients?.holdoutPercentage ?? 0,
      ignoreGlobalHoldout: false,
    };
  }

  return patch;
}

export async function listCampaigns(
  cfg: BirdCampaignClientConfig,
  limit = 100,
): Promise<BirdCampaign[]> {
  const capped = Math.min(limit, 100);
  const json = await birdJson<unknown>(
    cfg.apiKey,
    `${campaignsPath(cfg.workspaceId)}?limit=${capped}`,
    { method: "GET" },
  );
  return unwrapList<BirdCampaign>(json);
}

export async function findCampaignByName(
  cfg: BirdCampaignClientConfig,
  name: string,
): Promise<BirdCampaign | null> {
  const target = name.trim().toLowerCase();
  const list = await listCampaigns(cfg);
  return list.find((c) => (c.name ?? "").trim().toLowerCase() === target) ?? null;
}

/** Best-effort: id of the first broadcast under a campaign (idempotency reads). */
async function firstBroadcastId(
  cfg: BirdCampaignClientConfig,
  campaignId: string,
): Promise<string | null> {
  try {
    const json = await birdJson<unknown>(
      cfg.apiKey,
      broadcastsPath(cfg.workspaceId, campaignId),
      { method: "GET" },
    );
    return unwrapList<BirdBroadcast>(json)[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a review-first Bird draft campaign via the verified nested flow.
 * Idempotent: if a campaign with the same name already exists it is returned
 * untouched (existed=true). The caller owns the deterministic name
 * (`${event_code}_${job_type}_${YYYYMMDD}`).
 */
export async function createDraftCampaign(
  input: CreateDraftCampaignInput,
): Promise<CreateDraftCampaignResult> {
  const apiKey = input.apiKey ?? process.env.BIRD_API_KEY?.trim();
  if (!apiKey) throw new Error("BIRD_API_KEY required for Bird campaign creation");
  const cfg: BirdCampaignClientConfig = { apiKey, workspaceId: input.workspaceId };

  const existing = await findCampaignByName(cfg, input.name);
  if (existing) {
    return {
      campaignId: existing.id,
      broadcastId: await firstBroadcastId(cfg, existing.id),
      editUrl: birdCampaignEditUrl(input.workspaceId, existing.id),
      status: existing.status ?? "draft",
      existed: true,
    };
  }

  // 1. Campaign envelope.
  const campaign = await birdJson<BirdCampaign>(apiKey, campaignsPath(input.workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name }),
  });
  if (!campaign.id) throw new Error("Bird campaign create returned no id");
  const cid = campaign.id;

  // 2. Broadcast child (minimal — PATCH fills the config).
  const broadcast = await birdJson<BirdBroadcast>(apiKey, broadcastsPath(input.workspaceId, cid), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "channel" }),
  });
  if (!broadcast.id) throw new Error("Bird broadcast create returned no id");
  const bid = broadcast.id;

  // 3. Configure the broadcast. Preserve the schedule the empty draft returned.
  const patch = buildBroadcastPatch({
    projectId: input.projectId,
    projectVersionId: input.projectVersionId,
    defaultLocale: input.defaultLocale,
    variables: input.variables,
    channelId: input.channelId,
    schedule: broadcast.schedule ?? defaultBroadcastSchedule(),
    recipients: input.recipients,
  });
  const res = await birdFetch(apiKey, `${broadcastsPath(input.workspaceId, cid)}/${bid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(
      `[d2c bird campaign] PATCH broadcast failed status=${res.status} campaign=${cid} broadcast=${bid} body=${text.slice(0, 800)}`,
    );
    throw new BirdHttpError(res.status, text);
  }

  return {
    campaignId: cid,
    broadcastId: bid,
    editUrl: birdCampaignEditUrl(input.workspaceId, cid),
    status: "draft",
    existed: false,
  };
}
