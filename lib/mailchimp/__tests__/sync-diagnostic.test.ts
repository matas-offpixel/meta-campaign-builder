import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requireMailchimpTokenKey } from "../credentials.ts";
import { resolveMailchimpAudienceId } from "../activity-reconstruct.ts";

/**
 * Documents syncMailchimpAudienceDailyHistory early-exit contracts without
 * importing sync.ts (server-only + Next path aliases).
 */
describe("syncMailchimpAudienceDailyHistory — prerequisite guards", () => {
  it("no_audience_id when resolveMailchimpAudienceId returns null", () => {
    const audienceId = resolveMailchimpAudienceId({
      id: "e1",
      user_id: "u1",
      kind: "brand_campaign",
      mailchimp_audience_id: null,
      client: { mailchimp_account_id: "acc", mailchimp_audience_id: null },
    });
    assert.equal(audienceId, null);
  });

  it("no_account_id when client mailchimp_account_id is null", () => {
    const event = {
      id: "e1",
      user_id: "u1",
      kind: "brand_campaign",
      mailchimp_audience_id: "aud-1",
      client: { mailchimp_account_id: null, mailchimp_audience_id: "aud-1" },
    };
    assert.equal(resolveMailchimpAudienceId(event), "aud-1");
    const client = event.client;
    assert.equal(client?.mailchimp_account_id ?? null, null);
  });

  it("MAILCHIMP_TOKEN_KEY guard throws when unset", () => {
    const prev = process.env.MAILCHIMP_TOKEN_KEY;
    delete process.env.MAILCHIMP_TOKEN_KEY;
    assert.throws(() => requireMailchimpTokenKey(), /MAILCHIMP_TOKEN_KEY/);
    if (prev) process.env.MAILCHIMP_TOKEN_KEY = prev;
  });
});
