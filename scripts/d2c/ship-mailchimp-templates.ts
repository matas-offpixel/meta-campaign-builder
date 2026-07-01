/**
 * scripts/d2c/ship-mailchimp-templates.ts
 *
 * CLI to ship a brand's Mailchimp templates. Mirrors ship-bird-templates.ts.
 *
 *   node --experimental-strip-types scripts/d2c/ship-mailchimp-templates.ts \
 *     --brand jackies [--templates announcement,presale_live] \
 *     [--client-id <uuid>] [--dry-run] [--api-key-env-var JACKIES_MAILCHIMP_API_KEY]
 *
 * Credential resolution (see lib/d2c/mailchimp/credentials.ts): env var only
 * in the CLI (local dev). The admin route + cron resolve from d2c_connections.
 */

import { resolveMailchimpCredentials } from "../../lib/d2c/mailchimp/credentials.ts";
import { shipMailchimpTemplates } from "../../lib/d2c/mailchimp/templates/runner.ts";

interface Args {
  brand: string;
  templateNames?: string[];
  clientId?: string;
  dryRun: boolean;
  apiKeyEnvVar?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (n: string): string | undefined => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const brand = get("brand");
  if (!brand) {
    console.error("Usage: --brand <jackies|throwback> [--templates a,b] [--client-id uuid] [--dry-run] [--api-key-env-var NAME]");
    process.exit(1);
  }
  const templates = get("templates");
  return {
    brand,
    templateNames: templates ? templates.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    clientId: get("client-id"),
    dryRun: argv.includes("--dry-run"),
    apiKeyEnvVar: get("api-key-env-var"),
  };
}

function icon(outcome: string): string {
  return { created: "✓", skipped_exists: "↷", dry_run: "○", invalid: "⚠", error: "✗" }[outcome] ?? "?";
}

async function main() {
  const args = parseArgs();

  const creds = await resolveMailchimpCredentials({
    envVarName: args.apiKeyEnvVar,
  });
  if (!creds) {
    console.error(
      `No Mailchimp credentials. Set ${args.apiKeyEnvVar ?? "JACKIES_MAILCHIMP_API_KEY"} (format <key>-us7).`,
    );
    process.exit(1);
  }

  console.log(`\n▶ ship-mailchimp-templates brand=${args.brand} dc=${creds.serverPrefix} src=${creds.source}${args.dryRun ? " (DRY RUN)" : ""}`);
  const report = await shipMailchimpTemplates(
    { serverPrefix: creds.serverPrefix, apiKey: creds.apiKey },
    args.brand,
    { dryRun: args.dryRun, templateNames: args.templateNames },
  );

  console.log("");
  for (const r of report.results) {
    const id = r.templateId != null ? ` id=${r.templateId}` : "";
    const subj = r.subject ? ` subject="${r.subject}"` : "";
    console.log(`  ${icon(r.outcome)} ${r.name} [${r.kind}] ${r.outcome}${id}${subj}`);
    if (r.error) console.log(`      ${r.errorCode ?? ""}: ${r.error}`);
  }

  const ids = report.results.filter((r) => r.templateId != null).map((r) => `${r.name}=${r.templateId}`);
  if (ids.length) console.log(`\n  IDs: ${ids.join("  ")}`);
  const failed = report.results.filter((r) => r.outcome === "error" || r.outcome === "invalid");
  console.log(`\n  summary: ${report.results.length} template(s), ${failed.length} error(s).`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
