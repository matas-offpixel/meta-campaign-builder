/**
 * lib/d2c/mailchimp/templates/runner.ts
 *
 * Idempotency-first orchestration for shipping a brand's Mailchimp templates.
 * Shared by the CLI (scripts/d2c/ship-mailchimp-templates.ts) and the admin
 * route. Mirrors lib/d2c/bird/templates/runner.ts.
 */

import { buildTemplateHtml } from "./builder.ts";
import {
  createTemplate,
  findTemplateByName,
  type MailchimpClientConfig,
} from "./client.ts";
import { getMailchimpBrandConfig } from "./definitions/index.ts";
import { validateMailchimpDefinition, type MailchimpTemplateDefinition } from "./types.ts";

export type MailchimpTemplateOutcome =
  | "created"
  | "skipped_exists"
  | "dry_run"
  | "invalid"
  | "error";

export interface MailchimpTemplateResult {
  name: string;
  kind: string;
  outcome: MailchimpTemplateOutcome;
  templateId?: number;
  subject?: string;
  error?: string;
  errorCode?: string;
}

export interface MailchimpShipReport {
  brand: string;
  serverPrefix: string;
  dryRun: boolean;
  results: MailchimpTemplateResult[];
}

export interface MailchimpShipOptions {
  dryRun?: boolean;
  /** Restrict to these template names. */
  templateNames?: string[];
}

function selectTemplates(
  all: MailchimpTemplateDefinition[],
  names?: string[],
): MailchimpTemplateDefinition[] {
  if (!names || names.length === 0) return all;
  const want = new Set(names.map((n) => n.trim()));
  // accept either the full name (jackies_announcement) or the kind (announcement)
  return all.filter((t) => want.has(t.name) || want.has(t.kind));
}

export async function shipMailchimpTemplates(
  cfg: MailchimpClientConfig,
  brand: string,
  opts: MailchimpShipOptions = {},
): Promise<MailchimpShipReport> {
  const brandCfg = getMailchimpBrandConfig(brand);
  const dryRun = opts.dryRun ?? false;
  const selected = selectTemplates(brandCfg.templates, opts.templateNames);
  const results: MailchimpTemplateResult[] = [];

  for (const def of selected) {
    const base = { name: def.name, kind: def.kind };
    try {
      const problems = validateMailchimpDefinition(def);
      if (problems.length) {
        results.push({
          ...base,
          outcome: "invalid",
          error: problems.join("; "),
          errorCode: "MC_TPL_INVALID",
        });
        continue;
      }

      const built = buildTemplateHtml(def, brandCfg.theme);

      if (dryRun) {
        results.push({ ...base, outcome: "dry_run", subject: built.subject });
        continue;
      }

      const existing = await findTemplateByName(cfg, def.name);
      if (existing) {
        results.push({
          ...base,
          outcome: "skipped_exists",
          templateId: existing.id,
          subject: built.subject,
        });
        continue;
      }

      const created = await createTemplate(cfg, {
        name: def.name,
        html: built.html,
      });
      results.push({
        ...base,
        outcome: "created",
        templateId: created.id,
        subject: built.subject,
      });
    } catch (e) {
      const err = e as { message?: string; status?: number };
      results.push({
        ...base,
        outcome: "error",
        error: err?.message ?? String(e),
        errorCode: err?.status ? `MC_HTTP_${err.status}` : "MC_TPL_ERROR",
      });
    }
  }

  return { brand, serverPrefix: cfg.serverPrefix, dryRun, results };
}
