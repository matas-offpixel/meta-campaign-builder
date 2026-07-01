import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTemplateHtml } from "../builder.ts";
import { jackiesMailchimpConfig } from "../definitions/jackies.ts";
import { throwbackMailchimpConfig } from "../definitions/throwback.ts";
import { extractMergeTags, validateMailchimpDefinition } from "../types.ts";

const theme = jackiesMailchimpConfig.theme;

test("builder: emits merge tags verbatim and CTA url", () => {
  const def = jackiesMailchimpConfig.templates.find((t) => t.kind === "presale_live")!;
  const { html, subject } = buildTemplateHtml(def, theme);
  assert.match(html, /\*\|EVENT_NAME\|\*/, "EVENT_NAME merge tag present");
  assert.match(html, /href="\*\|TICKET_URL\|\*"/, "CTA points at TICKET_URL");
  assert.ok(subject.includes("*|EVENT_NAME|*"));
});

test("builder: artwork block renders when showArtwork", () => {
  const def = jackiesMailchimpConfig.templates.find((t) => t.showArtwork)!;
  const { html } = buildTemplateHtml(def, theme);
  assert.match(html, /src="\*\|ARTWORK_URL\|\*"/);
});

test("builder: uses inline styles + brand colours (Outlook-safe)", () => {
  const def = jackiesMailchimpConfig.templates[0];
  const { html } = buildTemplateHtml(def, theme);
  assert.match(html, /background-color:#E63329/i);
  assert.match(html, /style="/); // inline styles present
  assert.match(html, /<table/); // table layout
  assert.doesNotMatch(html, /<link/); // no external stylesheet
});

test("builder: escapes static copy but leaves merge tags intact", () => {
  const def = {
    ...jackiesMailchimpConfig.templates[0],
    headline: "Rock & Roll <live>",
  };
  const { html } = buildTemplateHtml(def, theme);
  assert.match(html, /Rock &amp; Roll &lt;live&gt;/);
});

test("all jackies + throwback definitions validate and cover 5 kinds", () => {
  for (const cfg of [jackiesMailchimpConfig, throwbackMailchimpConfig]) {
    assert.equal(cfg.templates.length, 5, `${cfg.brand} has 5 templates`);
    const kinds = new Set(cfg.templates.map((t) => t.kind));
    assert.equal(kinds.size, 5, `${cfg.brand} covers 5 distinct kinds`);
    for (const def of cfg.templates) {
      assert.deepEqual(validateMailchimpDefinition(def), [], `${def.name} valid`);
    }
  }
});

test("extractMergeTags finds referenced vars", () => {
  const def = jackiesMailchimpConfig.templates.find((t) => t.kind === "announcement")!;
  const tags = extractMergeTags(def);
  assert.ok(tags.includes("EVENT_NAME"));
  assert.ok(tags.includes("WA_COMMUNITY_URL"));
  assert.ok(tags.includes("ARTWORK_URL"));
});
