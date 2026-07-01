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

// ─── Projects ───────────────────────────────────────────────────────────────

export async function listProjects(
  cfg: BirdTemplateClientConfig,
  limit = 100,
): Promise<BirdProject[]> {
  // limit > 100 → 422 (verified); cap it.
  const capped = Math.min(limit, 100);
  const json = await birdJson<unknown>(cfg.apiKey, `${ws(cfg)}/projects?limit=${capped}`, {
    method: "GET",
  });
  return unwrapList<BirdProject>(json);
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

export async function listTemplates(
  cfg: BirdTemplateClientConfig,
  projectId: string,
  limit = 100,
): Promise<BirdTemplate[]> {
  const capped = Math.min(limit, 100);
  const json = await birdJson<unknown>(
    cfg.apiKey,
    `${ws(cfg)}/projects/${projectId}/channel-templates?limit=${capped}`,
    { method: "GET" },
  );
  return unwrapList<BirdTemplate>(json);
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
