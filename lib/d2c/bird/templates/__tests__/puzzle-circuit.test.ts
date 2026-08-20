import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTemplatePayload } from "../builder.ts";
import { puzzleCircuitTemplates } from "../definitions/puzzle-circuit.ts";
import type { BirdImageBlock, BirdLinkActionBlock, BirdTextBlock } from "../types.ts";

const PUZZLE_CHANNEL_GROUP = "81675dc0-c9f0-4521-b207-47e15b897ede";

function def(name: string) {
  const found = puzzleCircuitTemplates.find((t) => t.name === name);
  assert.ok(found, `definition "${name}" is missing`);
  return found;
}

/** Mirrors how `runner.ts` builds the payload, so these assert the real wire body. */
function payloadFor(name: string) {
  const d = def(name);
  return buildTemplatePayload(d, {
    channelGroupIds: [PUZZLE_CHANNEL_GROUP],
    shortLinks: d.shortLinks ?? true,
  });
}

test("every Puzzle definition builds and declares its template name explicitly", () => {
  for (const t of puzzleCircuitTemplates) {
    const payload = buildTemplatePayload(t, { channelGroupIds: [PUZZLE_CHANNEL_GROUP] });
    const declared = payload.deployments.find((d) => d.key === "whatsappTemplateName");
    // Bird's API never auto-generates this — the UI does, then freezes it. An
    // absent name ships a template Meta cannot address.
    assert.equal(declared?.value, t.name, `${t.name}: whatsappTemplateName not declared`);
  }
});

test("presale-live carries exactly one URL button, to Skiddle", () => {
  const payload = payloadFor("puzzle_southampton_17_10_26_presale_live");
  const blocks = payload.platformContent[0].blocks;
  const buttons = blocks.filter(
    (b): b is BirdLinkActionBlock => b.type === "link-action",
  );
  assert.equal(buttons.length, 1, "Meta review is per-button — exactly one is signed off");
  assert.equal(buttons[0].linkAction.text, "GET YOUR TICKET");
  assert.match(buttons[0].linkAction.url, /^https:\/\/www\.skiddle\.com\/whats-on\//);
});

test("presale-live is a fixed-artwork, variable-free image template", () => {
  const payload = payloadFor("puzzle_southampton_17_10_26_presale_live");
  assert.deepEqual(payload.variables, [], "a variable would need a Meta example value");
  assert.equal(payload.defaultLocale, "en");
  assert.equal(payload.platformContent.length, 1);
  assert.equal(payload.platformContent[0].type, "image");
});

test("presale-live copy says 'very soon', never a same-day time claim", () => {
  // An approved template is permanent and reusable. "later today" would be
  // false the moment Meta clears it after the lineup has landed — that framing
  // belongs only to the one-shot email + community post.
  const payload = payloadFor("puzzle_southampton_17_10_26_presale_live");
  const body = payload.platformContent[0].blocks.find(
    (b): b is BirdTextBlock => b.type === "text" && b.role === "body",
  );
  assert.ok(body, "body block missing");
  assert.match(body.text.text, /\*very soon\*/);
  assert.doesNotMatch(body.text.text, /later today/i);
  assert.doesNotMatch(body.text.text, /tomorrow/i);
  assert.match(body.text.text, /£10/);
});

test("presale-live ships into its hand-named Bird project, not the slug", () => {
  // Bird's UI names projects in human form and slugs that into the template
  // name; the runner would otherwise create a second, slug-named project.
  assert.equal(
    def("puzzle_southampton_17_10_26_presale_live").projectName,
    "Puzzle-Southampton-17.10.26 presale live",
  );
});

test("every Puzzle template opts out of Bird link-shortening", () => {
  // `PUT …/activate` 500s on a shortLinks-enabled template when the caller is
  // an API key (audit Phase 3, 2026-08-20). These are all shipped by accesskey.
  for (const t of puzzleCircuitTemplates) {
    assert.equal(t.shortLinks, false, `${t.name}: shortLinks must be false to activate`);
  }
});

test("the runner honours a definition's shortLinks opt-out", () => {
  const payload = payloadFor("puzzle_southampton_17_10_26_presale_live");
  assert.equal(payload.shortLinks.enabled, false);
});

test("lineup first look reveals on the lineup artwork, not the teaser", () => {
  const payload = payloadFor("puzzle_southampton_17_10_26_lineup_first_look");
  const header = payload.platformContent[0].blocks.find(
    (b): b is BirdImageBlock => b.type === "image",
  );
  assert.ok(header, "header image missing");
  assert.match(header.image.mediaUrl, /puzzle-circuit-lineup-1080\.jpg$/);
  assert.doesNotMatch(header.image.mediaUrl, /teaser/);
});

test("lineup first look carries one button and the signed-off copy verbatim", () => {
  const payload = payloadFor("puzzle_southampton_17_10_26_lineup_first_look");
  const blocks = payload.platformContent[0].blocks;
  const buttons = blocks.filter(
    (b): b is BirdLinkActionBlock => b.type === "link-action",
  );
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].linkAction.text, "GET YOUR TICKET");

  const body = blocks.find(
    (b): b is BirdTextBlock => b.type === "text" && b.role === "body",
  );
  assert.ok(body);
  assert.equal(
    body.text.text,
    "*FIRST LOOK AT THE LINEUP*\n" +
      "*LAST CHANCE FOR £10 TICKETS*\n\n" +
      "We couldn't hold it any longer and are beyond excited to welcome *Jamback, Mella Dee, Cam Stockman, Li Li* and many more for our return to Southampton.\n\n" +
      "Last chance for £10 tickets. They come off sale at *5pm today* — that's when the lineup goes public with a sign up for the next release of tickets.",
  );
  // Four bold spans is the house maximum; an odd count means an unclosed span,
  // which WhatsApp renders as a literal asterisk.
  assert.equal((body.text.text.match(/\*/g) ?? []).length, 8);
});

test("lineup first look is marked single-use where Bird's picker shows it", () => {
  // It pins "5pm today" — true for exactly one broadcast. The project name is
  // the only thing an operator sees when attaching a template to a send.
  const d = def("puzzle_southampton_17_10_26_lineup_first_look");
  assert.match(d.projectName ?? "", /^Puzzle-Southampton-17\.10\.26 lineup first look/);
  assert.match(d.projectName ?? "", /SINGLE USE/);
});

test("signup phase 2 reveals on the lineup artwork — never the teaser", () => {
  // The teaser reads "LINEUP DROPPING SOON" across the middle; on a post-reveal
  // autoresponder that contradicts the message it is attached to.
  const payload = payloadFor("puzzle_southampton_17_10_26_signup_phase2");
  const header = payload.platformContent[0].blocks.find(
    (b): b is BirdImageBlock => b.type === "image",
  );
  assert.ok(header, "header image missing");
  assert.match(header.image.mediaUrl, /puzzle-circuit-lineup-1080\.jpg$/);
  assert.doesNotMatch(header.image.mediaUrl, /teaser/);
});

test("signup phase 2 button is the full Brighton-style label to the community", () => {
  const payload = payloadFor("puzzle_southampton_17_10_26_signup_phase2");
  const buttons = payload.platformContent[0].blocks.filter(
    (b): b is BirdLinkActionBlock => b.type === "link-action",
  );
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].linkAction.text, "JOIN WHATSAPP COMMUNITY");
  assert.equal(buttons[0].linkAction.url, "https://app.offpixel.co.uk/j/puzzle-circuit");
});

test("signup phase 2 copy is verbatim, one bold span, no manual STOP line", () => {
  const payload = payloadFor("puzzle_southampton_17_10_26_signup_phase2");
  const body = payload.platformContent[0].blocks.find(
    (b): b is BirdTextBlock => b.type === "text" && b.role === "body",
  );
  assert.ok(body);
  assert.equal(
    body.text.text,
    "Thank you for signing up for Puzzle at Circuit, Southampton on Saturday 17th October 2026.\n\n" +
      "The presale for the next release of tickets begins *12pm Tuesday 25th August*.\n\n" +
      "To receive your ticket link 30 minutes ahead of time, join the WhatsApp community below. Demand is expected to be high — secure your spot early when the time comes.",
  );
  // Exactly one bold span (2 asterisks) — deliberate, matching Brighton.
  assert.equal((body.text.text.match(/\*/g) ?? []).length, 2);
  // WhatsApp appends its own opt-out on marketing templates; a manual one dupes it.
  assert.doesNotMatch(body.text.text, /reply stop/i);
  // General sale follows on 26 Aug, so this is not the last release.
  assert.match(body.text.text, /next release/);
  assert.doesNotMatch(body.text.text, /final release/i);
  // No footer block — the definition declares none.
  assert.equal(
    payload.platformContent[0].blocks.some((b) => b.type === "text" && b.role === "footer"),
    false,
  );
});

test("superseded announce templates stay out of the shipped set", () => {
  const names = puzzleCircuitTemplates.map((t) => t.name);
  for (const dead of [
    "puzzle_circuit_oct17_announce_en",
    "puzzle_southampton_17_10_26_announce_v2",
  ]) {
    assert.equal(names.includes(dead), false, `${dead} carries unsigned copy`);
  }
});
