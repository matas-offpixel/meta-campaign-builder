import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { diagnoseMailchimpForEvent } from "../diagnose.ts";

function mockSupabase(handlers: {
  snapshotCount?: number;
  accountRow?: { credentials_encrypted?: string | null } | null;
}) {
  return {
    from(table: string) {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (table === "mailchimp_audience_snapshots" && opts?.head) {
            return {
              eq: async () => ({ count: handlers.snapshotCount ?? 0 }),
            };
          }
          if (table === "mailchimp_accounts") {
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: handlers.accountRow ?? null }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
    },
  };
}

const baseEvent = {
  id: "68535c85-0394-435f-9439-245dd2e87043",
  mailchimp_audience_id: "aud-123",
  client: {
    mailchimp_account_id: "mc-acc-1",
    mailchimp_audience_id: null,
  },
};

describe("diagnoseMailchimpForEvent", () => {
  const originalTokenKey = process.env.MAILCHIMP_TOKEN_KEY;

  beforeEach(() => {
    process.env.MAILCHIMP_TOKEN_KEY = "test-key-12345678";
  });

  afterEach(() => {
    if (originalTokenKey === undefined) {
      delete process.env.MAILCHIMP_TOKEN_KEY;
    } else {
      process.env.MAILCHIMP_TOKEN_KEY = originalTokenKey;
    }
  });

  it("scenario 1: no audience — returns no_audience_id", async () => {
    const result = await diagnoseMailchimpForEvent(
      mockSupabase({}) as never,
      {
        ...baseEvent,
        mailchimp_audience_id: null,
        client: { mailchimp_account_id: "mc-acc-1", mailchimp_audience_id: null },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, "no_audience_id");
    assert.equal(result.audienceId, null);
  });

  it("scenario 2: no account — returns no_account_id", async () => {
    const result = await diagnoseMailchimpForEvent(
      mockSupabase({}) as never,
      {
        ...baseEvent,
        client: { mailchimp_account_id: null, mailchimp_audience_id: null },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.includes("no_account_id"), true);
    assert.equal(result.credentialsPresent, false);
  });

  it("scenario 3: missing credentials_encrypted — surfaces re-connect message", async () => {
    const result = await diagnoseMailchimpForEvent(
      mockSupabase({ accountRow: { credentials_encrypted: null } }) as never,
      baseEvent,
    );
    assert.equal(result.ok, false);
    assert.equal(result.credentialsPresent, false);
    assert.equal(
      result.error?.includes("credentials_encrypted"),
      true,
    );
  });

  it("scenario 4: MAILCHIMP_TOKEN_KEY unset — surfaces env error", async () => {
    delete process.env.MAILCHIMP_TOKEN_KEY;
    const result = await diagnoseMailchimpForEvent(
      mockSupabase({
        accountRow: { credentials_encrypted: "encrypted-blob" },
      }) as never,
      baseEvent,
    );
    assert.equal(result.ok, false);
    assert.equal(result.tokenKeyConfigured, false);
    assert.equal(result.error, "MAILCHIMP_TOKEN_KEY not configured on server");
  });
});
