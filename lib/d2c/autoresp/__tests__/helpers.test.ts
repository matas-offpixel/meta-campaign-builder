import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readAutorespConfig,
  isAutorespArmed,
  readAutorespLastPollAt,
  mergeAutorespResultJsonb,
  shouldFireAutoresp,
  resolveAutorespRecipient,
  normaliseE164,
  buildCustomerJourneyChecklist,
} from "../helpers.ts";

test("readAutorespConfig parses a well-formed config", () => {
  const cfg = readAutorespConfig({
    autoresp_config: { enabled: true, armed_at: "2026-07-08T09:00:00Z", armed_by: "u1" },
  });
  assert.deepEqual(cfg, {
    enabled: true,
    armed_at: "2026-07-08T09:00:00Z",
    armed_by: "u1",
  });
});

test("readAutorespConfig returns null for missing / malformed", () => {
  assert.equal(readAutorespConfig(null), null);
  assert.equal(readAutorespConfig({}), null);
  assert.equal(readAutorespConfig({ autoresp_config: 42 }), null);
});

test("readAutorespConfig coerces enabled to a strict boolean", () => {
  assert.equal(readAutorespConfig({ autoresp_config: { enabled: "yes" } })?.enabled, false);
  assert.equal(readAutorespConfig({ autoresp_config: { enabled: true } })?.enabled, true);
});

test("isAutorespArmed reflects enabled", () => {
  assert.equal(isAutorespArmed({ autoresp_config: { enabled: true } }), true);
  assert.equal(isAutorespArmed({ autoresp_config: { enabled: false } }), false);
  assert.equal(isAutorespArmed({}), false);
});

test("readAutorespLastPollAt reads the cursor", () => {
  assert.equal(readAutorespLastPollAt({ autoresp_last_poll_at: "2026-07-08T09:00:00Z" }), "2026-07-08T09:00:00Z");
  assert.equal(readAutorespLastPollAt({}), null);
});

test("mergeAutorespResultJsonb preserves other keys", () => {
  const merged = mergeAutorespResultJsonb(
    { metrics: { opens: 5 }, autoresp_config: { enabled: false, armed_at: null, armed_by: null } },
    { config: { enabled: true, armed_at: "t", armed_by: "u" }, lastPollAt: "p" },
  );
  assert.deepEqual(merged.metrics, { opens: 5 });
  assert.deepEqual(merged.autoresp_config, { enabled: true, armed_at: "t", armed_by: "u" });
  assert.equal(merged.autoresp_last_poll_at, "p");
});

test("mergeAutorespResultJsonb tolerates non-object existing", () => {
  const merged = mergeAutorespResultJsonb(null, { backfill: { status: "pending" } });
  assert.deepEqual(merged, { autoresp_backfill: { status: "pending" } });
});

test("shouldFireAutoresp only fires when armed AND not already fired", () => {
  const armed = { enabled: true, armed_at: null, armed_by: null };
  assert.equal(shouldFireAutoresp({ config: armed, alreadyFired: false }), true);
  assert.equal(shouldFireAutoresp({ config: armed, alreadyFired: true }), false);
  assert.equal(
    shouldFireAutoresp({ config: { enabled: false, armed_at: null, armed_by: null }, alreadyFired: false }),
    false,
  );
  assert.equal(shouldFireAutoresp({ config: null, alreadyFired: false }), false);
});

test("resolveAutorespRecipient (mailchimp) lower-cases + validates emails", () => {
  assert.equal(resolveAutorespRecipient({ email: "Fan@Example.com" }, "mailchimp"), "fan@example.com");
  assert.equal(resolveAutorespRecipient({ email: "  a@b.co " }, "mailchimp"), "a@b.co");
  assert.equal(resolveAutorespRecipient({ email: "not-an-email" }, "mailchimp"), null);
  assert.equal(resolveAutorespRecipient({ email: "" }, "mailchimp"), null);
  assert.equal(resolveAutorespRecipient({ email: null }, "mailchimp"), null);
});

test("resolveAutorespRecipient (bird) normalises phones to E.164", () => {
  assert.equal(resolveAutorespRecipient({ phone: "+44 7700 900000" }, "bird"), "+447700900000");
  assert.equal(resolveAutorespRecipient({ phone: "447700900000" }, "bird"), "+447700900000");
  assert.equal(resolveAutorespRecipient({ phone: "123" }, "bird"), null);
  assert.equal(resolveAutorespRecipient({ phone: null }, "bird"), null);
});

test("normaliseE164 rejects out-of-range lengths", () => {
  assert.equal(normaliseE164("1234567"), null); // 7 digits — too short
  assert.equal(normaliseE164("1234567890123456"), null); // 16 digits — too long
  assert.equal(normaliseE164("+1 (415) 555-2671"), "+14155552671");
});

test("buildCustomerJourneyChecklist echoes the tag, suggests a name, dc-prefixes the URL", () => {
  const c = buildCustomerJourneyChecklist("T26-ALGARVE", "us7");
  assert.deepEqual(c, {
    tag: "T26-ALGARVE",
    suggestedJourneyName: "T26-ALGARVE-AUTO",
    journeysUrl: "https://us7.admin.mailchimp.com/journeys/",
  });
});

test("buildCustomerJourneyChecklist trims inputs and tolerates missing tag / dc", () => {
  assert.deepEqual(buildCustomerJourneyChecklist("  T26-MADRID  ", "  us7 "), {
    tag: "T26-MADRID",
    suggestedJourneyName: "T26-MADRID-AUTO",
    journeysUrl: "https://us7.admin.mailchimp.com/journeys/",
  });
  assert.deepEqual(buildCustomerJourneyChecklist(null, null), {
    tag: null,
    suggestedJourneyName: null,
    journeysUrl: "https://admin.mailchimp.com/journeys/",
  });
  assert.deepEqual(buildCustomerJourneyChecklist("", "  "), {
    tag: null,
    suggestedJourneyName: null,
    journeysUrl: "https://admin.mailchimp.com/journeys/",
  });
});
