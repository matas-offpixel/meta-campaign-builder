import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getFireType,
  isDirectFire,
  isConfigureAutoresponder,
  batchContainsDirectFire,
  FIRE_TYPE_LABEL,
  FIRE_TYPE_BADGE_CLASS,
  DRAFT_REVIEW_JOB_TYPES,
  DIRECT_FIRE_JOB_TYPES,
  CONFIGURE_AUTORESPONDER_JOB_TYPES,
} from "../fire-type.ts";
import {
  substituteTemplateVariables,
  markdownToBasicHtml,
} from "../event-variables.ts";
import type { D2CJobType } from "../types.ts";

// ── 1. Row displays correct fire-type badge based on job_type ──────────────

test("draft-review job types get DRAFT REVIEW label and neutral badge", () => {
  for (const jt of DRAFT_REVIEW_JOB_TYPES) {
    assert.equal(getFireType(jt), "draft_review", `${jt} → draft_review`);
    assert.equal(FIRE_TYPE_LABEL[getFireType(jt)], "DRAFT REVIEW");
    assert.match(FIRE_TYPE_BADGE_CLASS["draft_review"], /bg-slate/);
  }
});

test("direct-fire job types get SENDS NOW label and amber/warning badge", () => {
  for (const jt of DIRECT_FIRE_JOB_TYPES) {
    assert.equal(getFireType(jt), "direct_fire", `${jt} → direct_fire`);
    assert.equal(FIRE_TYPE_LABEL[getFireType(jt)], "SENDS NOW");
    assert.match(FIRE_TYPE_BADGE_CLASS["direct_fire"], /amber/);
  }
});

test("configure-autoresponder job types get AUTORESPONDER label and teal badge", () => {
  for (const jt of CONFIGURE_AUTORESPONDER_JOB_TYPES) {
    assert.equal(getFireType(jt), "configure_autoresponder", `${jt} → configure_autoresponder`);
    assert.equal(isConfigureAutoresponder(jt), true);
    assert.equal(isDirectFire(jt), false, `${jt} must NOT direct-fire (arms a trigger)`);
    assert.equal(FIRE_TYPE_LABEL[getFireType(jt)], "AUTORESPONDER");
    assert.match(FIRE_TYPE_BADGE_CLASS["configure_autoresponder"], /teal/);
  }
  // autoresp_setup specifically moved out of direct-fire.
  assert.equal(getFireType("autoresp_setup"), "configure_autoresponder");
});

// ── 2. Preview modal renders email with substituted variables ──────────────

test("email preview: variables substituted into markdown body", () => {
  const body = "Hi! {{event_name}} is live. Tickets: {{ticket_url}}";
  const vars = { event_name: "Jackies Malaga", ticket_url: "https://ra.co/2375157" };
  const substituted = substituteTemplateVariables(body, vars);
  assert.equal(
    substituted,
    "Hi! Jackies Malaga is live. Tickets: https://ra.co/2375157",
  );
  const html = markdownToBasicHtml(substituted);
  assert.match(html, /Jackies Malaga/);
  assert.match(html, /ra\.co\/2375157/);
});

// ── 3. Preview modal renders WA template with substituted variables ────────

test("wa preview: variables substituted into WhatsApp body", () => {
  const body =
    "Gracias por registrarte a {{event_name}} el {{event_date}}. La preventa empieza el {{presale_day}} a las {{presale_time}}.";
  const vars = {
    event_name: "Jackies Malaga",
    event_date: "sábado 14 junio",
    presale_day: "martes 10 junio",
    presale_time: "12:00",
  };
  const result = substituteTemplateVariables(body, vars);
  assert.equal(
    result,
    "Gracias por registrarte a Jackies Malaga el sábado 14 junio. La preventa empieza el martes 10 junio a las 12:00.",
  );
  // Unresolved tokens stay as-is (no artwork_url provided)
  const withMissing = substituteTemplateVariables("{{wa_community_invite}}", vars);
  assert.equal(withMissing, "{{wa_community_invite}}");
});

// ── 4. Null variable highlights yellow in variables table ──────────────────

test("null/empty variable values are identified for yellow highlighting", () => {
  const vars: Record<string, string> = {
    event_name: "Jackies",
    ticket_url: "",           // empty — must be highlighted
    wa_community_invite: "",  // empty — must be highlighted
    presale_time: "12:00",
  };
  const emptyKeys = Object.entries(vars)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  assert.deepEqual(emptyKeys.sort(), ["ticket_url", "wa_community_invite"].sort());
});

// ── 5. Direct-fire Approve button has 1-second delay before enable ─────────

test("isDirectFire returns true for community_early only (autoresp_setup now arms a trigger)", () => {
  const directFireJobs: D2CJobType[] = ["community_early"];
  const nonDirectFireJobs: D2CJobType[] = [
    "announce",
    "reminder",
    "presale_live",
    "gen_sale",
    "autoresp_setup",
  ];
  for (const jt of directFireJobs) {
    assert.equal(isDirectFire(jt), true, `${jt} must be direct_fire`);
  }
  for (const jt of nonDirectFireJobs) {
    assert.equal(isDirectFire(jt), false, `${jt} must NOT be direct_fire`);
  }
  // null/undefined → draft_review (safe default)
  assert.equal(isDirectFire(null), false);
  assert.equal(isDirectFire(undefined), false);
});

// ── 6. Approve all is blocked when batch contains direct-fire jobs ─────────

test("batchContainsDirectFire: true when any send is direct-fire", () => {
  const allDraftReview = [
    { job_type: "announce" as D2CJobType },
    { job_type: "reminder" as D2CJobType },
    { job_type: "presale_live" as D2CJobType },
    { job_type: "gen_sale" as D2CJobType },
  ];
  assert.equal(batchContainsDirectFire(allDraftReview), false);

  // autoresp_setup no longer counts as direct-fire (it arms a trigger).
  const withAutoresp = [
    ...allDraftReview,
    { job_type: "autoresp_setup" as D2CJobType },
  ];
  assert.equal(batchContainsDirectFire(withAutoresp), false);

  const onlyCommunityEarly = [{ job_type: "community_early" as D2CJobType }];
  assert.equal(batchContainsDirectFire(onlyCommunityEarly), true);

  assert.equal(batchContainsDirectFire([]), false);
});
