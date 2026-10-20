/**
 * Locale handling, the project/template name split, and the gen_sale milestone.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEventTemplateDefinitions,
  copyLangFor,
  eventTemplateName,
  EventTemplateInputError,
  WHATSAPP_MILESTONES,
} from "../from-event.ts";
import type { EventTemplateInput } from "../from-event.ts";

const MADRID: EventTemplateInput = {
  brand: "h26",
  eventSlug: "madrid_03_10_26",
  locale: "es",
  eventName: "Hop on the Top Madrid",
  venueName: "The Bassement Club",
  eventDateText: "sábado 3 de octubre",
  presaleDayText: "miércoles 5 de agosto",
  presaleTimeText: "12:00",
  artworkUrl: "https://cdn.example/h26.jpg",
  communityInvite: "GPHS1dVMJluLgJJaKc1CIv",
  ticketUrl: "https://ra.co/events/2500705",
  projectNames: {
    autoresp_setup: "h26-madrid-03.10.26 signup",
    reminder: "h26-madrid-03.10.26 presale reminder",
    presale_live: "h26-madrid-03.10.26 presale",
    gen_sale: "h26-madrid-03.10.26 general sale",
  },
};

test("gen_sale is a first-class milestone", () => {
  assert.deepEqual([...WHATSAPP_MILESTONES], [
    "autoresp_setup", "reminder", "presale_live", "gen_sale",
  ]);
  assert.equal(
    eventTemplateName(MADRID, "gen_sale"),
    "h26_madrid_03_10_26_general_sale_es",
  );
});

test("Spanish locale produces Spanish copy, not English under an es tag", () => {
  const defs = buildEventTemplateDefinitions(MADRID);
  for (const d of defs) {
    const body = d.body.es;
    assert.ok(body, `no es body for ${d.name}`);
    assert.ok(
      !/Thanks for signing up|presale opens tomorrow|Presale is now live|on general sale/i.test(body),
      `English copy leaked into an es template: ${d.name}`,
    );
  }
  assert.match(defs[0].body.es, /^Gracias por registrarte/);
  assert.match(defs[3].body.es, /ya están a la venta/);
});

test("Spanish button labels are Spanish", () => {
  const defs = buildEventTemplateDefinitions(MADRID);
  assert.equal(defs[0].button!.text.es, "UNIRTE A LA COMUNIDAD");
  assert.equal(defs[3].button!.text.es, "CONSEGUIR ENTRADA");
});

test("gen_sale uses the plain ticket link, not the community redirect", () => {
  const gen = buildEventTemplateDefinitions(MADRID, ["gen_sale"])[0];
  assert.equal(gen.button!.url, "https://ra.co/events/2500705");
  assert.ok(!gen.button!.url.includes("/j/"));
});

test("a regional locale resolves by primary subtag, not by exact match", () => {
  assert.equal(copyLangFor("es-ES"), "es");
  assert.equal(copyLangFor("es_MX"), "es");
  assert.equal(copyLangFor("en-GB"), "en");
});

test("an unsupported language throws instead of silently shipping English", () => {
  assert.throws(() => copyLangFor("pt"), EventTemplateInputError);
  assert.throws(
    () => buildEventTemplateDefinitions({ ...MADRID, locale: "pt-PT" }),
    EventTemplateInputError,
  );
});

test("project name is human-facing; template name stays Meta-legal", () => {
  const defs = buildEventTemplateDefinitions(MADRID);
  const META_NAME = /^[a-z0-9_]+$/; // Meta's whatsappTemplateName constraint
  for (const d of defs) {
    assert.match(d.name, META_NAME, `template name not Meta-legal: ${d.name}`);
    // The operator-supplied project name carries spaces and dots, which would
    // be rejected as a template name — that is exactly why they are separate.
    assert.ok(d.projectName?.includes(" "), `project name lost: ${d.name}`);
    assert.ok(!META_NAME.test(d.projectName!), `project name unexpectedly Meta-legal`);
  }
  assert.equal(defs[2].projectName, "h26-madrid-03.10.26 presale");
  assert.equal(defs[2].name, "h26_madrid_03_10_26_presale_live_es");
});

test("omitting projectNames leaves the project named after the template", () => {
  const noProjectNames = { ...MADRID };
  delete noProjectNames.projectNames;
  for (const d of buildEventTemplateDefinitions(noProjectNames)) {
    assert.equal(d.projectName, undefined);
  }
});

test("every milestone is Marketing — all four mention price or urge purchase", () => {
  for (const d of buildEventTemplateDefinitions(MADRID)) {
    assert.equal(d.category, "MARKETING", d.name);
  }
});
