import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTemplatePayload, templateNameOf } from "../builder.ts";
import { validateDefinition, extractVariableKeys, TemplateDefinitionError } from "../types.ts";
import type { BrandTemplateDefinition } from "../types.ts";
import { throwbackTemplates } from "../definitions/throwback.ts";
import { jackiesTemplates } from "../definitions/jackies.ts";

let counter = 0;
const stableIds = () => `id-${counter++}`;
const resetIds = () => { counter = 0; };

const sampleDef = (): BrandTemplateDefinition => ({
  name: "throwback_autoresp",
  category: "UTILITY",
  locales: ["en", "es_ES"],
  body: {
    en: "Thanks for {{event_name}} on {{event_date}}.",
    es_ES: "Gracias por {{event_name}} el {{event_date}}.",
  },
  footer: { en: "Reply STOP to unsubscribe.", es_ES: "Responde STOP para darte de baja." },
  button: {
    text: { en: "JOIN", es_ES: "UNIRTE" },
    url: "https://chat.whatsapp.com/{{wa_community_invite}}",
  },
  variableExamples: {
    event_artwork_url: { en: "https://x/a.jpg", es_ES: "https://x/a.jpg" },
    event_name: { en: "Throwback - PORTO", es_ES: "Throwback - PORTO" },
    event_date: { en: "Sat 6 June", es_ES: "sábado 6 junio" },
    wa_community_invite: { en: "ABC123", es_ES: "ABC123" },
  },
});

test("extractVariableKeys finds named tokens, deduped, in order", () => {
  assert.deepEqual(
    extractVariableKeys("{{a}} then {{b}} then {{a}} and {{ c }}"),
    ["a", "b", "c"],
  );
});

test("builder emits correct deployments (name + category)", () => {
  resetIds();
  const p = buildTemplatePayload(sampleDef(), { idFactory: stableIds });
  assert.deepEqual(p.deployments, [
    { key: "whatsappTemplateName", platform: "whatsapp", value: "throwback_autoresp" },
    { key: "whatsappCategory", platform: "whatsapp", value: "UTILITY" },
  ]);
  assert.equal(templateNameOf(p), "throwback_autoresp");
});

test("builder normalises es_ES → es-ES and sets defaultLocale", () => {
  resetIds();
  const p = buildTemplatePayload(sampleDef(), { idFactory: stableIds });
  assert.equal(p.defaultLocale, "en");
  assert.deepEqual(p.platformContent.map((c) => c.locale), ["en", "es-ES"]);
});

test("builder declares every referenced variable with per-locale examples", () => {
  resetIds();
  const p = buildTemplatePayload(sampleDef(), { idFactory: stableIds });
  const keys = p.variables.map((v) => v.key).sort();
  assert.deepEqual(keys, ["event_artwork_url", "event_date", "event_name", "wa_community_invite"]);
  const name = p.variables.find((v) => v.key === "event_name")!;
  assert.deepEqual(name.examplesLocale["en"].exampleValueStrings, ["Throwback - PORTO"]);
  assert.deepEqual(name.examplesLocale["es-ES"].exampleValueStrings, ["Throwback - PORTO"]);
  assert.equal(name.type, "string");
  assert.equal(name.format, "none");
});

test("builder emits header/body/footer/button blocks with shared ids across locales", () => {
  resetIds();
  const p = buildTemplatePayload(sampleDef(), { idFactory: stableIds });
  const [en, es] = p.platformContent;
  assert.deepEqual(en.blocks.map((b) => b.type), ["image", "text", "text", "link-action"]);
  // header image references the artwork variable
  const enHeader = en.blocks[0];
  assert.equal(enHeader.type, "image");
  if (enHeader.type === "image") assert.equal(enHeader.image.mediaUrl, "{{event_artwork_url}}");
  // block ids shared across locales, positionally
  assert.deepEqual(en.blocks.map((b) => b.id), es.blocks.map((b) => b.id));
  // button url carries the token verbatim (named, not positional)
  const btn = en.blocks[3];
  if (btn.type === "link-action") assert.equal(btn.linkAction.url, "https://chat.whatsapp.com/{{wa_community_invite}}");
});

test("first locale carries type=image, subsequent locales type=null", () => {
  resetIds();
  const p = buildTemplatePayload(sampleDef(), { idFactory: stableIds });
  assert.equal(p.platformContent[0].type, "image");
  assert.equal(p.platformContent[1].type, null);
});

test("channelGroupIds included only when provided", () => {
  resetIds();
  const draft = buildTemplatePayload(sampleDef(), { idFactory: stableIds });
  assert.equal(draft.platformContent[0].channelGroupIds, undefined);
  resetIds();
  const submitted = buildTemplatePayload(sampleDef(), { idFactory: stableIds, channelGroupIds: ["cg-1"] });
  assert.deepEqual(submitted.platformContent[0].channelGroupIds, ["cg-1"]);
});

test("onlyLocales filters platformContent and defaultLocale", () => {
  resetIds();
  const p = buildTemplatePayload(sampleDef(), { idFactory: stableIds, onlyLocales: ["es_ES"] });
  assert.deepEqual(p.platformContent.map((c) => c.locale), ["es-ES"]);
  assert.equal(p.defaultLocale, "es-ES");
});

test("validateDefinition throws when a referenced var lacks examples", () => {
  const bad = sampleDef();
  delete (bad.variableExamples as Record<string, unknown>).wa_community_invite;
  assert.throws(() => validateDefinition(bad), TemplateDefinitionError);
});

test("validateDefinition throws on bad template name", () => {
  const bad = sampleDef();
  bad.name = "Throwback Autoresp";
  assert.throws(() => validateDefinition(bad), /snake_case/);
});

test("all shipped brand definitions validate + build", () => {
  for (const def of [...throwbackTemplates, ...jackiesTemplates]) {
    resetIds();
    const p = buildTemplatePayload(def, { idFactory: stableIds, channelGroupIds: ["cg"] });
    assert.ok(p.platformContent.length >= 1, `${def.name} has locales`);
    assert.equal(templateNameOf(p), def.name);
    // shortLinks default off
    assert.equal(p.shortLinks.enabled, false);
    assert.deepEqual(p.supportedPlatforms, ["whatsapp"]);
    assert.deepEqual(p.genericContent, []);
  }
});

test("jackies templates are es-ES only", () => {
  for (const def of jackiesTemplates) {
    resetIds();
    const p = buildTemplatePayload(def, { idFactory: stableIds });
    assert.deepEqual(p.platformContent.map((c) => c.locale), ["es-ES"]);
  }
});
