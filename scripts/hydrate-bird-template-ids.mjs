#!/usr/bin/env node
/**
 * scripts/hydrate-bird-template-ids.mjs
 *
 * One-shot: hydrate `projectId` + `projectVersionId` for every Bird channel
 * template in the workspace. The broadcast-campaign flow
 * (lib/d2c/bird/campaigns/client.ts) needs BOTH — a template definition that
 * only stores a name can't be referenced in `content.channelTemplate`.
 *
 * Walks GET /workspaces/{wid}/projects → GET …/projects/{pid}/channel-templates,
 * keys each template by its `whatsappTemplateName` deployment, and prints a
 * name → { projectId, projectVersionId, status } map to paste into the brand
 * definition files (lib/d2c/bird/templates/definitions/*).
 *
 * Standalone (no TS import) so it runs with plain node + AccessKey auth:
 *   BIRD_API_KEY=... node scripts/hydrate-bird-template-ids.mjs
 *   BIRD_API_KEY=... node scripts/hydrate-bird-template-ids.mjs --json
 *
 * `projectVersionId` bumps on every template edit — re-run after any change.
 */

const BIRD_API_BASE = process.env.BIRD_API_BASE?.trim() || "https://api.bird.com";
const WORKSPACE_ID =
  process.env.BIRD_WORKSPACE_ID?.trim() || "9c308f77-c5ed-44d3-9714-9da017c7536c";
const API_KEY = process.env.BIRD_API_KEY?.trim();
const AS_JSON = process.argv.includes("--json");

async function birdGet(path) {
  const res = await fetch(`${BIRD_API_BASE}${path}`, {
    headers: {
      Authorization: `AccessKey ${API_KEY}`,
      accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

function unwrapList(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const k of ["results", "data", "channelTemplates", "projects", "items"]) {
      if (Array.isArray(json[k])) return json[k];
    }
  }
  return [];
}

function templateNameOf(tpl) {
  const dep = (tpl.deployments ?? []).find((d) => d.key === "whatsappTemplateName");
  return dep?.value ?? null;
}

async function main() {
  if (!API_KEY) throw new Error("BIRD_API_KEY not set");

  const projects = unwrapList(await birdGet(`/workspaces/${WORKSPACE_ID}/projects?limit=100`));
  const registry = {};

  for (const project of projects) {
    let templates = [];
    try {
      templates = unwrapList(
        await birdGet(
          `/workspaces/${WORKSPACE_ID}/projects/${project.id}/channel-templates?limit=100`,
        ),
      );
    } catch (e) {
      console.warn(`  ! skip project ${project.id} (${project.name ?? "?"}): ${e.message}`);
      continue;
    }
    for (const tpl of templates) {
      const name = templateNameOf(tpl);
      if (!name) continue;
      registry[name] = {
        projectId: tpl.projectId ?? project.id,
        projectVersionId: tpl.id,
        status: tpl.status ?? "unknown",
      };
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify(registry, null, 2));
    return;
  }

  const names = Object.keys(registry).sort();
  if (names.length === 0) {
    console.log("No channel templates found in workspace", WORKSPACE_ID);
    return;
  }
  console.log(`\nBird template ids (workspace ${WORKSPACE_ID}):\n`);
  for (const name of names) {
    const r = registry[name];
    console.log(`  ${name}`);
    console.log(`    projectId:        ${r.projectId}`);
    console.log(`    projectVersionId: ${r.projectVersionId}`);
    console.log(`    status:           ${r.status}\n`);
  }
  console.log("Paste projectId + projectVersionId into the matching definition in");
  console.log("lib/d2c/bird/templates/definitions/*. projectVersionId bumps on edit.\n");
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
