import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEmailCopy,
  buildSegmentOpts,
  campaignTitle,
  mailchimpCopyLang,
  MailchimpCampaignInputError,
  savedTemplateName,
  MAILCHIMP_MILESTONES,
} from "../event-campaigns.ts";
import type { MailchimpEventInput } from "../event-campaigns.ts";

const MADRID: MailchimpEventInput = {
  baseName: "h26-madrid-03.10.26",
  locale: "es",
  eventName: "Hop on the Top Madrid",
  venueName: "The Bassement Club",
  eventDateText: "sábado 3 de octubre",
  presaleDayText: "miércoles 5 de agosto",
  presaleTimeText: "12:00",
  generalSaleDayText: "lunes 10 de agosto",
  artworkUrl: "https://cdn.example/h26.jpg",
  ticketUrl: "https://ra.co/events/2500705",
  communityUrl: "https://app.offpixel.co.uk/j/GPHS1dVMJluLgJJaKc1CIv",
};

const EVENT_SEG = 8800540;
const LANG_SEG = 8800501;

test("the signup autoresponder is a first-class campaign milestone", () => {
  // It ships as BOTH a saved template and a Regular Email campaign draft:
  // "Replicate to automation" sources from a campaign, not a template.
  assert.ok(MAILCHIMP_MILESTONES.includes("autoresp_setup"));
  assert.equal(campaignTitle(MADRID.baseName, "autoresp_setup"), "h26-madrid-03.10.26 signup autoresponder");
  // campaign title and saved-template name must match so they pair in the UI
  assert.equal(campaignTitle(MADRID.baseName, "autoresp_setup"), savedTemplateName(MADRID.baseName));
});

test("the autoresponder targets the event tag, and never excludes it", () => {
  const o = buildSegmentOpts("autoresp_setup", { eventSegmentId: EVENT_SEG });
  assert.deepEqual(o.conditions, [
    { condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: EVENT_SEG },
  ]);
  assert.ok(!o.conditions.some((c) => c.op === "static_not"));
});

test("names follow the Bird project-name convention", () => {
  assert.equal(campaignTitle(MADRID.baseName, "announce"), "h26-madrid-03.10.26 announcement");
  assert.equal(campaignTitle(MADRID.baseName, "reminder"), "h26-madrid-03.10.26 presale reminder");
  assert.equal(campaignTitle(MADRID.baseName, "presale_live"), "h26-madrid-03.10.26 presale");
  assert.equal(campaignTitle(MADRID.baseName, "gen_sale"), "h26-madrid-03.10.26 general sale");
  assert.equal(savedTemplateName(MADRID.baseName), "h26-madrid-03.10.26 signup autoresponder");
});

// ── targeting: the part that can silently mis-send ──────────────────────────

test("announcement EXCLUDES the event tag — its job is to drive signups", () => {
  const o = buildSegmentOpts("announce", { eventSegmentId: EVENT_SEG });
  assert.equal(o.match, "all");
  assert.deepEqual(o.conditions, [
    { condition_type: "StaticSegment", field: "static_segment", op: "static_not", value: EVENT_SEG },
  ]);
});

test("reminder / live / gen_sale INCLUDE the event tag", () => {
  for (const m of ["reminder", "presale_live", "gen_sale"] as const) {
    const o = buildSegmentOpts(m, { eventSegmentId: EVENT_SEG });
    assert.deepEqual(o.conditions, [
      { condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: EVENT_SEG },
    ], m);
  }
});

test("language scopes the announcement, whose base is the whole audience", () => {
  const o = buildSegmentOpts("announce", { eventSegmentId: EVENT_SEG, languageSegmentId: LANG_SEG });
  assert.equal(o.match, "all");
  assert.deepEqual(o.conditions.map((c) => [c.op, c.value]), [
    ["static_is", LANG_SEG],
    ["static_not", EVENT_SEG],
  ]);
});

test("language does NOT scope tag stages by default — it would target zero", () => {
  // Measured on the first live brief: the only contact tagged
  // H26-MADRID-03.10.26 is not in the legacy SPANISH segment, so intersecting
  // would have produced a send to nobody, with no error.
  for (const m of ["reminder", "presale_live", "gen_sale"] as const) {
    const o = buildSegmentOpts(m, { eventSegmentId: EVENT_SEG, languageSegmentId: LANG_SEG });
    assert.equal(o.conditions.length, 1, m);
    assert.equal(o.conditions[0].value, EVENT_SEG, m);
  }
});

test("applyLanguageToTagStages opts in explicitly", () => {
  const o = buildSegmentOpts("reminder", {
    eventSegmentId: EVENT_SEG, languageSegmentId: LANG_SEG, applyLanguageToTagStages: true,
  });
  assert.deepEqual(o.conditions.map((c) => [c.op, c.value]), [
    ["static_is", LANG_SEG],
    ["static_is", EVENT_SEG],
  ]);
});

test("every milestone always yields at least one condition — never an unscoped send", () => {
  for (const m of MAILCHIMP_MILESTONES) {
    assert.ok(buildSegmentOpts(m, { eventSegmentId: EVENT_SEG }).conditions.length >= 1, m);
  }
});

// ── copy ────────────────────────────────────────────────────────────────────

test("Spanish locale yields Spanish copy in subject, preview and body", () => {
  for (const m of MAILCHIMP_MILESTONES) {
    const c = buildEmailCopy(m, MADRID);
    assert.ok(!/Presale opens|on general sale|You're registered/i.test(c.subject + c.preview + c.html), m);
  }
  assert.match(buildEmailCopy("presale_live", MADRID).subject, /^Preventa activa/);
  assert.match(buildEmailCopy("autoresp_setup", MADRID).html, /Gracias por registrarte/);
});

test("the autoresponder carries the community link, not the ticket link", () => {
  const c = buildEmailCopy("autoresp_setup", MADRID);
  assert.ok(c.html.includes("https://app.offpixel.co.uk/j/GPHS1dVMJluLgJJaKc1CIv"));
});

test("ticket stages link straight to the ticket URL", () => {
  for (const m of ["reminder", "presale_live", "gen_sale"] as const) {
    assert.ok(buildEmailCopy(m, MADRID).html.includes("https://ra.co/events/2500705"), m);
  }
});

test("html escapes interpolated facts", () => {
  const c = buildEmailCopy("presale_live", { ...MADRID, eventName: 'Hop <script>"x"' });
  assert.ok(!c.html.includes("<script>"));
  assert.ok(c.html.includes("&lt;script&gt;"));
});

test("html carries an unsubscribe merge tag", () => {
  for (const m of MAILCHIMP_MILESTONES) {
    assert.ok(buildEmailCopy(m, MADRID).html.includes("*|UNSUB|*"), m);
  }
});

test("regional locales resolve by primary subtag; unsupported throws", () => {
  assert.equal(mailchimpCopyLang("es-ES"), "es");
  assert.equal(mailchimpCopyLang("en-GB"), "en");
  assert.throws(() => mailchimpCopyLang("pt"), MailchimpCampaignInputError);
});

test("missing facts fail loudly rather than rendering blanks", () => {
  assert.throws(() => buildEmailCopy("announce", { ...MADRID, venueName: "" }), MailchimpCampaignInputError);
  assert.throws(() => buildEmailCopy("announce", { ...MADRID, artworkUrl: "/rel.jpg" }), MailchimpCampaignInputError);
});
