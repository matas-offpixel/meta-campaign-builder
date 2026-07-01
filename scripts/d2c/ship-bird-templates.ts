/**
 * scripts/d2c/ship-bird-templates.ts
 *
 * CLI to create Bird Studio WhatsApp templates for a brand, idempotently.
 *
 * Usage (source .env.local first so BIRD_API_KEY / BIRD_WORKSPACE_ID are set):
 *
 *   set -a && source .env.local && set +a && \
 *     npx tsx scripts/d2c/ship-bird-templates.ts --brand throwback [--dry-run] \
 *       [--locales en,es_ES] [--templates throwback_autoresp,throwback_presale_reminder] [--submit]
 *
 * Also runs under: node --experimental-strip-types --env-file=.env.local scripts/d2c/ship-bird-templates.ts …
 *
 * Every create is a Bird *draft*; Meta submission is a separate Studio action
 * (audit §U8) — `--submit` currently reports `publish_unsupported`.
 */

import { shipBrandTemplates, type ShipOptions } from "../../lib/d2c/bird/templates/runner.ts";

interface CliArgs extends ShipOptions {
  brand: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--brand": out.brand = next(); break;
      case "--dry-run": out.dryRun = true; break;
      case "--submit": out.submit = true; break;
      case "--no-channel-group": out.attachChannelGroup = false; break;
      case "--locales": out.locales = next()?.split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--templates": out.templateNames = next()?.split(",").map((s) => s.trim()).filter(Boolean); break;
      default:
        if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (!out.brand) throw new Error("--brand is required (e.g. --brand throwback)");
  return out as CliArgs;
}

function icon(outcome: string): string {
  return { created: "✓", skipped_exists: "↷", dry_run: "○", publish_unsupported: "⚠", error: "✗" }[outcome] ?? "?";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.BIRD_API_KEY;
  const workspaceId = process.env.BIRD_WORKSPACE_ID ?? "9c308f77-c5ed-44d3-9714-9da017c7536c";
  if (!apiKey) {
    console.error("BIRD_API_KEY not set. Source .env.local first.");
    process.exit(1);
  }

  console.log(`\n▶ ship-bird-templates brand=${args.brand}${args.dryRun ? " (DRY RUN)" : ""}`);
  const report = await shipBrandTemplates({ apiKey, workspaceId }, args.brand, args);

  console.log(`  channelGroup: ${report.channelGroupId ?? "(none — drafts only)"}\n`);
  for (const r of report.results) {
    const id = r.templateId ? ` id=${r.templateId}` : "";
    const st = r.status ? ` status=${r.status}` : "";
    const proj = r.projectId ? ` project=${r.projectId}${r.projectCreated ? "(new)" : ""}` : "";
    console.log(`  ${icon(r.outcome)} ${r.name} [${r.locales.join(",")}] ${r.outcome}${id}${st}${proj}`);
    if (r.error) console.log(`      ${r.errorCode ?? ""}: ${r.error}`);
  }

  const createdIds = report.results.filter((r) => r.templateId).map((r) => `${r.name}=${r.templateId}`);
  if (createdIds.length) console.log(`\n  IDs: ${createdIds.join("  ")}`);
  const failed = report.results.filter((r) => r.outcome === "error");
  console.log(`\n  summary: ${report.results.length} template(s), ${failed.length} error(s).`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
