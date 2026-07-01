/**
 * Integration test against a live Bird probe project. Skips entirely when
 * BIRD_API_KEY is absent (CI, most local runs). When present, it:
 *   1. creates a fresh `_test_probe_delete_me` project,
 *   2. builds + creates a draft template (no channelGroup → never hits Meta),
 *   3. asserts status "draft" and idempotency skip on re-create,
 *   4. deletes the template + project (cleanup in finally).
 *
 * Run:  set -a && source .env.local && set +a && \
 *       node --experimental-strip-types --test lib/d2c/bird/templates/__tests__/integration.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createProject,
  createTemplate,
  deleteProject,
  deleteTemplate,
  findTemplateByName,
  type BirdTemplateClientConfig,
} from "../client.ts";
import { buildTemplatePayload } from "../builder.ts";
import type { BrandTemplateDefinition } from "../types.ts";

const apiKey = process.env.BIRD_API_KEY;
const workspaceId = process.env.BIRD_WORKSPACE_ID ?? "9c308f77-c5ed-44d3-9714-9da017c7536c";

const probeDef: BrandTemplateDefinition = {
  name: "probe_integration_delete_me",
  category: "UTILITY",
  locales: ["en"],
  body: { en: "Integration probe for {{event_name}}." },
  footer: { en: "Reply STOP to unsubscribe." },
  variableExamples: {
    event_artwork_url: { en: "https://app.bird.com/studio/default-block-content/sale.jpg" },
    event_name: { en: "Probe" },
  },
};

test(
  "bird templates: create draft + idempotency + cleanup",
  { skip: apiKey ? false : "BIRD_API_KEY not set" },
  async () => {
    const cfg: BirdTemplateClientConfig = { apiKey: apiKey!, workspaceId };
    let projectId: string | null = null;
    let templateId: string | null = null;
    try {
      const project = await createProject(cfg, "_test_probe_delete_me");
      projectId = project.id;
      assert.ok(projectId, "project created");

      const payload = buildTemplatePayload(probeDef); // no channelGroup → draft, no Meta
      const created = await createTemplate(cfg, projectId, payload);
      templateId = created.id;
      assert.equal(created.status, "draft", "create yields a draft (never submitted to Meta)");

      const found = await findTemplateByName(cfg, projectId, "probe_integration_delete_me");
      assert.ok(found, "idempotency lookup finds the created template");
      assert.equal(found!.id, templateId);
    } finally {
      if (projectId && templateId) await deleteTemplate(cfg, projectId, templateId).catch(() => {});
      if (projectId) await deleteProject(cfg, projectId).catch(() => {});
    }
  },
);
