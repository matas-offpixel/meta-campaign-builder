/**
 * Multiple URL buttons on one WhatsApp template.
 *
 * Needed for stages that carry both a ticket CTA and a community CTA. Meta
 * caps URL buttons at 2, so the cap is enforced here rather than discovered
 * when Meta rejects a submitted template hours later.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTemplatePayload } from "../builder.ts";
import {
  allButtons,
  MAX_WHATSAPP_URL_BUTTONS,
  TemplateDefinitionError,
  validateDefinition,
} from "../types.ts";
import type { BrandTemplateDefinition } from "../types.ts";

const base = (): BrandTemplateDefinition => ({
  name: "two_button_tpl",
  category: "MARKETING",
  locales: ["es"],
  headerImageUrl: "https://cdn.example/poster.jpg",
  body: { es: "Cuerpo." },
  variableExamples: {},
});

const TICKET = "https://ra.co/events/2500746";
const COMMUNITY = "https://app.offpixel.co.uk/j/L6s5DjB8ZbhAEFiSf08m4y";

test("two buttons emit two link-action blocks in order", () => {
  const def: BrandTemplateDefinition = {
    ...base(),
    buttons: [
      { text: { es: "CONSIGUE TU ENTRADA" }, url: TICKET },
      { text: { es: "ÚNETE A LA COMUNIDAD" }, url: COMMUNITY },
    ],
  };
  const p = buildTemplatePayload(def, { shortLinks: true });
  const links = p.platformContent[0].blocks.filter((b) => b.type === "link-action");
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((b) => [(b as { linkAction: { text: string; url: string } }).linkAction.text,
                      (b as { linkAction: { url: string } }).linkAction.url]),
    [["CONSIGUE TU ENTRADA", TICKET], ["ÚNETE A LA COMUNIDAD", COMMUNITY]],
  );
  // distinct ids — a shared id would collapse the buttons in Bird
  const ids = links.map((b) => (b as { id: string }).id);
  assert.equal(new Set(ids).size, 2);
});

test("the single `button` form still works unchanged", () => {
  const def: BrandTemplateDefinition = { ...base(), button: { text: { es: "SOLO" }, url: TICKET } };
  const p = buildTemplatePayload(def);
  const links = p.platformContent[0].blocks.filter((b) => b.type === "link-action");
  assert.equal(links.length, 1);
  assert.equal(allButtons(def).length, 1);
});

test("more than Meta's cap is rejected at build time, not by Meta", () => {
  const def: BrandTemplateDefinition = {
    ...base(),
    buttons: [
      { text: { es: "A" }, url: TICKET },
      { text: { es: "B" }, url: COMMUNITY },
      { text: { es: "C" }, url: TICKET },
    ],
  };
  assert.equal(MAX_WHATSAPP_URL_BUTTONS, 2);
  assert.throws(() => validateDefinition(def), TemplateDefinitionError);
});

test("setting both button and buttons is rejected as ambiguous", () => {
  const def: BrandTemplateDefinition = {
    ...base(),
    button: { text: { es: "ONE" }, url: TICKET },
    buttons: [{ text: { es: "TWO" }, url: COMMUNITY }],
  };
  assert.throws(() => validateDefinition(def), TemplateDefinitionError);
});

test("a missing label on the second button fails loudly", () => {
  const def: BrandTemplateDefinition = {
    ...base(),
    buttons: [
      { text: { es: "OK" }, url: TICKET },
      { text: { en: "wrong locale" }, url: COMMUNITY },
    ],
  };
  assert.throws(() => validateDefinition(def), /button\[1\]\.text missing/);
});

test("variables referenced in any button url are declared", () => {
  const def: BrandTemplateDefinition = {
    ...base(),
    buttons: [
      { text: { es: "T" }, url: "https://ra.co/events/{{event_url_suffix}}" },
      { text: { es: "C" }, url: "https://app.offpixel.co.uk/j/{{wa_community_invite}}" },
    ],
    variableExamples: {
      event_url_suffix: { es: "2500746" },
      wa_community_invite: { es: "L6s5DjB8ZbhAEFiSf08m4y" },
    },
  };
  const keys = validateDefinition(def);
  assert.ok(keys.includes("event_url_suffix"));
  assert.ok(keys.includes("wa_community_invite"));
});
