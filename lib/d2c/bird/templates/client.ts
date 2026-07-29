/**
 * lib/d2c/bird/templates/client.ts
 *
 * Typed client for Bird Studio's internal channel-template + project API.
 * Reuses `../client.ts` (AccessKey auth + 20s timeout + 5xx retry). Every
 * non-2xx surfaces as `BirdHttpError` with the full body (already tagged by
 * the base client); helpers add operation-level context.
 *
 * ⚠️ Internal, undocumented endpoints. See the audit doc for the shapes.
 */

import { BirdHttpError, birdFetch, birdJson } from "../client.ts";
import type {
  BirdProject,
  BirdTemplate,
  BirdTemplateCreatePayload,
} from "./types.ts";

export interface BirdTemplateClientConfig {
  apiKey: string;
  workspaceId: string;
}

/** Bird list responses vary in envelope key; normalise to an array. */
function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["results", "data", "channelTemplates", "projects"]) {
      if (Array.isArray(o[k])) return o[k] as T[];
    }
  }
  return [];
}

function ws(cfg: BirdTemplateClientConfig): string {
  return `/workspaces/${cfg.workspaceId}`;
}

/** Bird caps `limit` at 100 (>100 → 422) and cursors via `nextPageToken`. */
const MAX_PAGE_SIZE = 100;
/** Backstop so a repeating/looping cursor can never spin forever. */
const MAX_PAGES = 100;

/**
 * Follow Bird's `nextPageToken` cursor to completion.
 *
 * Bird returns `{results, nextPageToken}` and caps `limit` at 100. Passing the
 * cursor back requires the query param **`pageToken`** — `nextPageToken` is
 * silently ignored and re-serves page 1, which is an easy and dangerous
 * mistake to make here (see the callers below: a truncated list makes
 * `findProjectByName` report "not found" for a project that exists, and the
 * caller then creates a duplicate).
 *
 * `maxItems` stops early for callers that only need a few rows.
 */
async function listAllPages<T>(
  cfg: BirdTemplateClientConfig,
  path: string,
  maxItems = Infinity,
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const remaining = maxItems - out.length;
    if (remaining <= 0) break;
    const params = new URLSearchParams({
      limit: String(Math.min(MAX_PAGE_SIZE, remaining)),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const json = await birdJson<unknown>(cfg.apiKey, `${path}?${params}`, {
      method: "GET",
    });
    const batch = unwrapList<T>(json);
    out.push(...batch);

    const next =
      json && typeof json === "object"
        ? (json as { nextPageToken?: unknown }).nextPageToken
        : undefined;
    // Stop on: no cursor, an empty page, or a cursor that did not advance.
    if (typeof next !== "string" || !next || batch.length === 0 || next === pageToken) {
      break;
    }
    pageToken = next;
  }

  return out.length > maxItems ? out.slice(0, maxItems) : out;
}

// ─── Projects ───────────────────────────────────────────────────────────────

/**
 * Every project in the workspace, across all pages. `maxItems` stops early.
 *
 * This MUST paginate: the workspace is already past 100 projects, and a
 * single-page read silently truncates the list.
 */
export async function listProjects(
  cfg: BirdTemplateClientConfig,
  maxItems = Infinity,
): Promise<BirdProject[]> {
  return listAllPages<BirdProject>(cfg, `${ws(cfg)}/projects`, maxItems);
}

export async function getProject(
  cfg: BirdTemplateClientConfig,
  projectId: string,
): Promise<BirdProject> {
  return birdJson<BirdProject>(cfg.apiKey, `${ws(cfg)}/projects/${projectId}`, {
    method: "GET",
  });
}

export async function findProjectByName(
  cfg: BirdTemplateClientConfig,
  name: string,
): Promise<BirdProject | null> {
  const target = name.trim().toLowerCase();
  const projects = await listProjects(cfg);
  return projects.find((p) => (p.name ?? "").trim().toLowerCase() === target) ?? null;
}

/**
 * Create a channel-template project. Verified body shape: `{name, type}`.
 * `type` is always `"channelTemplate"` for WhatsApp template projects.
 */
export async function createProject(
  cfg: BirdTemplateClientConfig,
  name: string,
): Promise<BirdProject> {
  return birdJson<BirdProject>(cfg.apiKey, `${ws(cfg)}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type: "channelTemplate" }),
  });
}

export async function deleteProject(
  cfg: BirdTemplateClientConfig,
  projectId: string,
): Promise<void> {
  const res = await birdFetch(cfg.apiKey, `${ws(cfg)}/projects/${projectId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new BirdHttpError(res.status, await res.text());
}

// ─── Templates ────────────────────────────────────────────────────────────

/** Every template in a project, across all pages. `maxItems` stops early. */
export async function listTemplates(
  cfg: BirdTemplateClientConfig,
  projectId: string,
  maxItems = Infinity,
): Promise<BirdTemplate[]> {
  return listAllPages<BirdTemplate>(
    cfg,
    `${ws(cfg)}/projects/${projectId}/channel-templates`,
    maxItems,
  );
}

export async function getTemplate(
  cfg: BirdTemplateClientConfig,
  projectId: string,
  templateId: string,
): Promise<BirdTemplate> {
  return birdJson<BirdTemplate>(
    cfg.apiKey,
    `${ws(cfg)}/projects/${projectId}/channel-templates/${templateId}`,
    { method: "GET" },
  );
}

export async function createTemplate(
  cfg: BirdTemplateClientConfig,
  projectId: string,
  payload: BirdTemplateCreatePayload,
): Promise<BirdTemplate> {
  return birdJson<BirdTemplate>(
    cfg.apiKey,
    `${ws(cfg)}/projects/${projectId}/channel-templates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function deleteTemplate(
  cfg: BirdTemplateClientConfig,
  projectId: string,
  templateId: string,
): Promise<void> {
  const res = await birdFetch(
    cfg.apiKey,
    `${ws(cfg)}/projects/${projectId}/channel-templates/${templateId}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new BirdHttpError(res.status, await res.text());
}

/**
 * The lifecycle state of a template, derived from its top-level `status` and
 * per-locale `platformInfo` entries. `draft` = never submitted; anything else
 * means it has already been sent to Meta at least once.
 */
export function templateActivationState(t: BirdTemplate): {
  status: string;
  submitted: boolean;
  platformStatuses: string[];
} {
  const platformStatuses = Object.values(t.platformInfo ?? {})
    .map((p) => p?.status)
    .filter((s): s is string => typeof s === "string");
  // Only Meta lifecycle states count as "submitted". `draft` and `inactive`
  // are local, pre-submission states (a created-but-not-activated template),
  // so they still need activation.
  const SUBMITTED = new Set(["pending", "active", "rejected", "paused", "disabled"]);
  const submitted =
    SUBMITTED.has(t.status) || platformStatuses.some((s) => SUBMITTED.has(s));
  return { status: t.status, submitted, platformStatuses };
}

export interface ActivateResult {
  templateId: string;
  activated: boolean;
  skipped: boolean;
  statusBefore: string;
  statusAfter: string;
  platformStatuses: string[];
}

/**
 * Activate (publish → submit to Meta) a template. Verified endpoint:
 * `PUT /workspaces/{wid}/projects/{pid}/channel-templates/{id}/activate`
 * (empty body, AccessKey auth). Idempotent: GETs the template first and skips
 * the PUT if it is already submitted (pending/active/rejected), so re-runs are
 * safe and never re-submit to Meta.
 */
export async function activateTemplate(
  cfg: BirdTemplateClientConfig,
  projectId: string,
  templateId: string,
): Promise<ActivateResult> {
  const before = await getTemplate(cfg, projectId, templateId);
  const stateBefore = templateActivationState(before);
  if (stateBefore.submitted) {
    return {
      templateId,
      activated: false,
      skipped: true,
      statusBefore: stateBefore.status,
      statusAfter: stateBefore.status,
      platformStatuses: stateBefore.platformStatuses,
    };
  }

  const res = await birdFetch(
    cfg.apiKey,
    `${ws(cfg)}/projects/${projectId}/channel-templates/${templateId}/activate`,
    { method: "PUT", headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new BirdHttpError(res.status, await res.text());

  // Re-read for the authoritative post-activation state.
  const after = await getTemplate(cfg, projectId, templateId);
  const stateAfter = templateActivationState(after);
  return {
    templateId,
    activated: true,
    skipped: false,
    statusBefore: stateBefore.status,
    statusAfter: stateAfter.status,
    platformStatuses: stateAfter.platformStatuses,
  };
}

/** Find a template in a project by its whatsappTemplateName. */
export async function findTemplateByName(
  cfg: BirdTemplateClientConfig,
  projectId: string,
  whatsappTemplateName: string,
): Promise<BirdTemplate | null> {
  const list = await listTemplates(cfg, projectId);
  return (
    list.find(
      (t) =>
        t.deployments?.find((d) => d.key === "whatsappTemplateName")?.value ===
        whatsappTemplateName,
    ) ?? null
  );
}

/**
 * Resolve a project's WABA channel group. Primary: the project's own
 * `approvedTemplateChannelGroupIds`. Fallback: read any existing template's
 * `platformContent[].channelGroupIds`. Returns null if neither is available
 * (a fresh project with no templates yet — caller must supply it explicitly).
 */
export async function resolveChannelGroup(
  cfg: BirdTemplateClientConfig,
  projectId: string,
): Promise<string | null> {
  const project = await getProject(cfg, projectId);
  const fromProject = project.approvedTemplateChannelGroupIds?.[0];
  if (fromProject) return fromProject;
  const templates = await listTemplates(cfg, projectId, 1);
  const fromTemplate = templates[0]?.platformContent?.find(
    (pc) => pc.channelGroupIds?.length,
  )?.channelGroupIds?.[0];
  return fromTemplate ?? null;
}
