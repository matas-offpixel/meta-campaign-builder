/**
 * lib/d2c/bird/templates/runner.ts
 *
 * Shared, idempotency-first orchestration used by BOTH the CLI
 * (`scripts/d2c/ship-bird-templates.ts`) and the admin route
 * (`app/api/admin/d2c/bird-templates/route.ts`). No process/exit, no console
 * required — returns a structured report the caller renders.
 *
 * Project model (verified — see audit): Bird Studio organises **one project
 * per template**, and a project may hold only ONE draft at a time
 * ("A draft item already exists in this project"). So each template is shipped
 * into its own project named after the template (created if absent). The
 * brand's WABA channel group is attached so the draft is submit-ready.
 *
 * Idempotency: if the per-template project already contains a template with
 * the same whatsappTemplateName (any status), it is skipped.
 *
 * NB: a create yields a Bird *draft*. Submitting to Meta ("publish") is a
 * separate Studio action that is not yet reverse-engineered (audit §U8), so
 * `submit` is accepted but reports `publish_unsupported` per template.
 */

import {
  createProject,
  createTemplate,
  findProjectByName,
  findTemplateByName,
  resolveChannelGroup,
  type BirdTemplateClientConfig,
} from "./client.ts";
import { buildTemplatePayload } from "./builder.ts";
import { getBrandConfig } from "./definitions/index.ts";
import type { BrandTemplateDefinition } from "./types.ts";

export type TemplateOutcome =
  | "created"
  | "skipped_exists"
  | "dry_run"
  | "publish_unsupported"
  | "error";

export interface TemplateResult {
  name: string;
  category: string;
  locales: string[];
  outcome: TemplateOutcome;
  projectId?: string;
  projectCreated?: boolean;
  templateId?: string;
  status?: string;
  error?: string;
  errorCode?: string;
}

export interface ShipReport {
  brand: string;
  channelGroupId: string | null;
  dryRun: boolean;
  results: TemplateResult[];
}

export interface ShipOptions {
  dryRun?: boolean;
  /** Restrict to these template names (whatsappTemplateName). */
  templateNames?: string[];
  /** Restrict to these locales (accepts es_ES or es-ES). */
  locales?: string[];
  /** Attempt Meta submission after create (currently unsupported — see §U8). */
  submit?: boolean;
  /** Attach the WABA channel group to created templates. Default true. */
  attachChannelGroup?: boolean;
}

function selectTemplates(
  all: BrandTemplateDefinition[],
  names?: string[],
): BrandTemplateDefinition[] {
  if (!names || names.length === 0) return all;
  const want = new Set(names.map((n) => n.trim()));
  return all.filter((t) => want.has(t.name));
}

export async function shipBrandTemplates(
  cfg: BirdTemplateClientConfig,
  brand: string,
  opts: ShipOptions = {},
): Promise<ShipReport> {
  const brandCfg = getBrandConfig(brand);
  const dryRun = opts.dryRun ?? false;
  const attachChannelGroup = opts.attachChannelGroup ?? true;
  const channelGroupId: string | null = brandCfg.channelGroupId ?? null;

  const selected = selectTemplates(brandCfg.templates, opts.templateNames);
  const results: TemplateResult[] = [];

  for (const def of selected) {
    const locales = opts.locales?.length
      ? def.locales.filter((l) =>
          opts.locales!.map((x) => x.replace("_", "-")).includes(l.replace("_", "-")),
        )
      : def.locales;
    const base: Omit<TemplateResult, "outcome"> = {
      name: def.name,
      category: def.category,
      locales,
    };

    try {
      // Resolve the WABA per template (explicit brand value, else read the
      // existing project's binding). Fresh per-template projects have none, so
      // brand-level explicit channelGroupId is the norm.
      let cg = attachChannelGroup ? channelGroupId : null;

      const payload = buildTemplatePayload(def, {
        channelGroupIds: cg ? [cg] : undefined,
        onlyLocales: opts.locales,
      });

      if (dryRun) {
        results.push({
          ...base,
          outcome: "dry_run",
          locales: payload.platformContent.map((p) => p.locale),
        });
        continue;
      }

      // One project per template (created if absent).
      const projectName = def.name;
      const existingProject = await findProjectByName(cfg, projectName);
      const project = existingProject ?? (await createProject(cfg, projectName));
      const projectCreated = !existingProject;

      // If the project pre-existed and had no explicit brand channelGroup, try
      // to resolve it from the project so the draft is submit-ready.
      if (attachChannelGroup && !cg && !projectCreated) {
        cg = await resolveChannelGroup(cfg, project.id);
        if (cg) {
          // rebuild with the resolved channel group
          Object.assign(
            payload,
            buildTemplatePayload(def, { channelGroupIds: [cg], onlyLocales: opts.locales }),
          );
        }
      }

      // Idempotency: skip if the template already exists in its project.
      const existing = await findTemplateByName(cfg, project.id, def.name);
      if (existing) {
        results.push({
          ...base,
          outcome: "skipped_exists",
          projectId: project.id,
          projectCreated,
          templateId: existing.id,
          status: existing.status,
        });
        continue;
      }

      const created = await createTemplate(cfg, project.id, payload);
      const result: TemplateResult = {
        ...base,
        outcome: "created",
        projectId: project.id,
        projectCreated,
        templateId: created.id,
        status: created.status,
      };
      if (opts.submit) {
        result.outcome = "publish_unsupported";
        result.error =
          "Template created as draft; Meta submission is a separate Studio action not yet automatable (audit §U8). Submit in Bird Studio.";
        result.errorCode = "BIRD_TPL_PUBLISH_UNSUPPORTED";
      }
      results.push(result);
    } catch (e) {
      const err = e as { message?: string; code?: string; status?: number };
      results.push({
        ...base,
        outcome: "error",
        error: err?.message ?? String(e),
        errorCode: err?.code ?? (err?.status ? `BIRD_HTTP_${err.status}` : "BIRD_TPL_ERROR"),
      });
    }
  }

  return { brand, channelGroupId, dryRun, results };
}
