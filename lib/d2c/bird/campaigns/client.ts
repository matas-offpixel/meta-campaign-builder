/**
 * lib/d2c/bird/campaigns/client.ts
 *
 * Typed client for Bird's broadcast **campaign** API — used to create
 * review-first DRAFT campaigns that Matas reviews, adds audiences to,
 * proof-tests and fires manually in the Bird UI.
 *
 * ⚠️ UNVERIFIED ENDPOINT — the `.scratch/bird-campaign-draft-capture.txt`
 * DevTools capture referenced by the sprint prompt was NOT present when this
 * was built, so the exact create URL + payload shape are best-effort,
 * derived from Bird's known Studio internal-API conventions (see
 * lib/d2c/bird/templates/client.ts) and the template/channel data we do have.
 *
 * This is SAFE because live campaign creation only runs when the 3-of-3 gate
 * is satisfied (FEATURE_D2C_LIVE + live_enabled + approved_by_matas), which is
 * off. Until the real capture lands:
 *   - Correct CAMPAIGNS_PATH / buildDraftPayload / editUrl below, and
 *   - flip DRAFT_CAMPAIGN_VERIFIED to true.
 * Every non-2xx surfaces the full response body via BirdHttpError.
 */

import { BirdHttpError, birdFetch, birdJson } from "../client.ts";

/** Set to true only once the endpoint + payload are confirmed against a capture. */
export const DRAFT_CAMPAIGN_VERIFIED = false;

const STUDIO_BASE = process.env.BIRD_STUDIO_BASE?.trim() || "https://studio.bird.com";

export interface BirdCampaignClientConfig {
  apiKey: string;
  workspaceId: string;
}

export interface BirdCampaign {
  id: string;
  name?: string;
  status?: string;
  editUrl?: string;
}

export interface CreateDraftCampaignInput {
  workspaceId: string;
  channelId: string;
  projectId: string;
  templateId: string;
  name: string;
  locale: string;
  variables: Record<string, string>;
  /**
   * Optional pre-populated recipients. If omitted, Bird shows an empty
   * recipient list and Matas picks lists/segments in the UI. If provided,
   * pre-populates a signup-tag segment reference.
   */
  recipients?: { tag?: string; audienceIds?: string[] };
  /** AccessKey; defaults to BIRD_API_KEY env. */
  apiKey?: string;
}

export interface CreateDraftCampaignResult {
  id: string;
  editUrl: string;
  status: string;
  /** true when this returned an existing campaign (idempotency skip). */
  existed: boolean;
}

function campaignsPath(workspaceId: string): string {
  // UNVERIFIED — best-effort. Override in one place once captured.
  return `/workspaces/${workspaceId}/campaigns`;
}

function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["results", "data", "campaigns", "items"]) {
      if (Array.isArray(o[k])) return o[k] as T[];
    }
  }
  return [];
}

export function birdCampaignEditUrl(workspaceId: string, campaignId: string): string {
  return `${STUDIO_BASE}/workspaces/${workspaceId}/campaigns/${campaignId}`;
}

/** Map resolved event vars → Bird's `{key,value}` parameters array. */
export function buildCampaignVariables(
  variables: Record<string, string>,
): { key: string; value: string }[] {
  return Object.entries(variables)
    .filter(([, v]) => v != null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
}

/** UNVERIFIED payload shape — see banner. Kept pure + exported for tests. */
export function buildDraftPayload(input: CreateDraftCampaignInput): Record<string, unknown> {
  const recipients = input.recipients?.tag
    ? { type: "segment", segmentTag: input.recipients.tag }
    : input.recipients?.audienceIds?.length
      ? { type: "audiences", audienceIds: input.recipients.audienceIds }
      : { type: "manual", audiences: [] };

  return {
    name: input.name,
    channelId: input.channelId,
    status: "draft",
    content: {
      type: "template",
      template: {
        projectId: input.projectId,
        templateId: input.templateId,
        locale: input.locale,
        parameters: buildCampaignVariables(input.variables),
      },
    },
    recipients,
  };
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

/**
 * Create a Bird draft campaign. Idempotent: if a campaign with the same name
 * already exists it is returned untouched (existed=true). The caller owns the
 * deterministic name (`${event_code}_${job_type}_${YYYYMMDD}`).
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
      id: existing.id,
      editUrl: existing.editUrl ?? birdCampaignEditUrl(input.workspaceId, existing.id),
      status: existing.status ?? "draft",
      existed: true,
    };
  }

  const payload = buildDraftPayload(input);
  const res = await birdFetch(cfg.apiKey, campaignsPath(cfg.workspaceId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(
      `[d2c bird campaign] create failed status=${res.status} name=${input.name} body=${text.slice(0, 800)}`,
    );
    throw new BirdHttpError(res.status, text);
  }
  const created = (text ? JSON.parse(text) : {}) as BirdCampaign;
  if (!created.id) throw new BirdHttpError(res.status, `No campaign id in response: ${text.slice(0, 300)}`);

  return {
    id: created.id,
    editUrl: created.editUrl ?? birdCampaignEditUrl(input.workspaceId, created.id),
    status: created.status ?? "draft",
    existed: false,
  };
}
