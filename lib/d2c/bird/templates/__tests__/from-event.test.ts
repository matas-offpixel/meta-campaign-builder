import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTemplatePayload } from "../builder.ts";
import {
  buildEventTemplateDefinitions,
  communityRedirectUrl,
  eventTemplateName,
  EventTemplateInputError,
} from "../from-event.ts";
import type { EventTemplateInput } from "../from-event.ts";
import { eventCampaignName } from "../../event-pipeline.ts";

const MONSANTOS: EventTemplateInput = {
  brand: "throwback",
  eventSlug: "monsantos",
  locale: "en",
  eventName: "Throwback Lisboa",
  venueName: "Monsantos Open Air",
  eventDateText: "Saturday 26 September",
  presaleDayText: "Wednesday 5 August",
  presaleTimeText: "12:00",
  artworkUrl: "https://cdn.example/monsantos.jpg",
  communityInvite: "https://chat.whatsapp.com/DHjPw1HRvipCu6S6ZT6d5P",
  ticketUrl: "https://ra.co/events/2486798",
};

test("names are deterministic — the whole pipeline's idempotency key", () => {
  assert.equal(
    eventTemplateName(MONSANTOS, "autoresp_setup"),
    "throwback_monsantos_signup_confirmation_en",
  );
  assert.equal(
    eventTemplateName(MONSANTOS, "reminder"),
    "throwback_monsantos_presale_reminder_en",
  );
  assert.equal(
    eventTemplateName(MONSANTOS, "presale_live"),
    "throwback_monsantos_presale_live_en",
  );
});

test("generated definitions reproduce the hand-written Monsantos copy exactly", () => {
  const defs = buildEventTemplateDefinitions(MONSANTOS);
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]));

  assert.equal(
    byName.throwback_monsantos_signup_confirmation_en.body.en,
    "Thanks for signing up for Throwback Lisboa at Monsantos Open Air, Saturday 26 September.\n\n" +
      "Presale opens Wednesday 5 August at 12:00. First tier at the best price.\n\n" +
      "Join the WhatsApp community to get the link 30 minutes before everyone else.",
  );
  assert.equal(
    byName.throwback_monsantos_presale_reminder_en.body.en,
    "Throwback Lisboa presale opens tomorrow, Wednesday 5 August, at 12:00. First tier at the best price.\n\n" +
      "Join the WhatsApp community for the link 30 min early.",
  );
  assert.equal(
    byName.throwback_monsantos_presale_live_en.body.en,
    "Presale is now live for Throwback Lisboa at Monsantos Open Air.\n\n" +
      "First tier at the best price — secure yours before it moves up.",
  );
});

test("community buttons use the approved redirect, never a raw invite link", () => {
  const defs = buildEventTemplateDefinitions(MONSANTOS);
  for (const d of defs) {
    const url = d.button!.url;
    if (url.includes("/j/")) {
      assert.equal(url, "https://app.offpixel.co.uk/j/DHjPw1HRvipCu6S6ZT6d5P");
    }
    assert.ok(!url.includes("chat.whatsapp.com"), `raw invite link leaked: ${url}`);
  }
});

test("a bare invite code is accepted and still routed through the redirect", () => {
  assert.equal(
    communityRedirectUrl("DHjPw1HRvipCu6S6ZT6d5P"),
    "https://app.offpixel.co.uk/j/DHjPw1HRvipCu6S6ZT6d5P",
  );
});

test("an unusable invite throws rather than emitting a dead button", () => {
  for (const bad of [null, undefined, "", "   ", "https://chat.whatsapp.com/"]) {
    assert.throws(() => communityRedirectUrl(bad), EventTemplateInputError, `accepted: ${bad}`);
  }
});

test("the ticket button stays a plain URL — the redirect is invite-only", () => {
  const live = buildEventTemplateDefinitions(MONSANTOS, ["presale_live"])[0];
  assert.equal(live.button!.url, "https://ra.co/events/2486798");
  assert.equal(live.button!.text.en, "GET YOUR TICKET");
});

test("templates declare zero variables and no footer", () => {
  for (const d of buildEventTemplateDefinitions(MONSANTOS)) {
    assert.deepEqual(d.variableExamples, {});
    assert.equal(d.footer, undefined);
    const payload = buildTemplatePayload(d, { shortLinks: true });
    assert.deepEqual(payload.variables, []);
    assert.equal(payload.platformContent[0].type, "image");
    assert.equal(
      payload.platformContent[0].blocks.some((b) => "role" in b && b.role === "footer"),
      false,
    );
  }
});

test("missing event facts fail loudly instead of rendering empty copy", () => {
  assert.throws(
    () => buildEventTemplateDefinitions({ ...MONSANTOS, venueName: "" }),
    EventTemplateInputError,
  );
  assert.throws(
    () => buildEventTemplateDefinitions({ ...MONSANTOS, artworkUrl: "/relative/path.jpg" }),
    EventTemplateInputError,
  );
});

test("campaign names are deterministic per template + send date", () => {
  assert.equal(
    eventCampaignName("throwback_monsantos_presale_reminder_en", {
      year: 2026, month: 8, day: 4, hour: 16, minute: 45,
    }),
    // Carries the full template name (locale included) so the campaign is
    // unambiguous when an event ships more than one locale.
    "throwback_monsantos_presale_reminder_en_20260804",
  );
});
