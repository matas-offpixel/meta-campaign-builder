/**
 * Maintenance utility: delete a Bird channel-template draft by brand + template
 * name. Resolves the per-template project by name, finds the template, deletes.
 *
 *   node --experimental-strip-types scripts/d2c/delete-bird-template.ts \
 *     --brand throwback --name throwback_presale_reminder
 *
 * Only ever deletes DRAFT/inactive templates you own. Never run against a
 * template already submitted to Meta unless you intend to withdraw it.
 */
import {
  deleteTemplate,
  findProjectByName,
  findTemplateByName,
} from "../../lib/d2c/bird/templates/client.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("name");
  if (!name) throw new Error("--name <whatsappTemplateName> required");
  const apiKey = process.env.BIRD_API_KEY;
  const workspaceId = process.env.BIRD_WORKSPACE_ID ?? "9c308f77-c5ed-44d3-9714-9da017c7536c";
  if (!apiKey) throw new Error("BIRD_API_KEY not set");
  const cfg = { apiKey, workspaceId };

  const project = await findProjectByName(cfg, name);
  if (!project) throw new Error(`No project named "${name}"`);
  const tpl = await findTemplateByName(cfg, project.id, name);
  if (!tpl) {
    console.log(`No template "${name}" in project ${project.id} — nothing to delete.`);
    return;
  }
  await deleteTemplate(cfg, project.id, tpl.id);
  console.log(`Deleted template ${tpl.id} (status=${tpl.status}) from project ${project.id}.`);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
