/**
 * fix(d2c/test-send): `is_test` fires (migration 144) must never dedup-lock
 * (or be blocked by) a real fire for the same (event, provider, member), and
 * must be excluded from the AutorespFireSummary aggregates the dashboard
 * shows. This is an in-memory simulation of the migration 144 partial unique
 * index (`WHERE is_test = false`) — the real constraint is enforced by
 * Postgres; this locks in the calling code's behavior against that contract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  claimAutorespFire,
  getAutorespFiresForSend,
} from "../d2c-autoresp.ts";

interface FakeRow extends Record<string, unknown> {
  id: string;
  event_id: string;
  send_id: string;
  provider: string;
  member_identifier: string;
  fired_at: string;
  dry_run: boolean;
  is_test: boolean;
  error: string | null;
}

class FakeAutorespFiresClient {
  rows: FakeRow[] = [];
  private idCounter = 0;

  from(table: string) {
    if (table !== "d2c_autoresp_fires") throw new Error(`unexpected table ${table}`);
    const self = this;
    return {
      insert(row: Record<string, unknown>) {
        return {
          select() {
            return {
              async maybeSingle() {
                const isTest = Boolean(row.is_test);
                // Mirrors the migration 144 partial unique index: only
                // non-test rows participate in the dedup conflict.
                if (!isTest) {
                  const conflict = self.rows.find(
                    (r) =>
                      !r.is_test &&
                      r.event_id === row.event_id &&
                      r.provider === row.provider &&
                      r.member_identifier === row.member_identifier,
                  );
                  if (conflict) {
                    return { data: null, error: { code: "23505", message: "duplicate key" } };
                  }
                }
                const id = `fire-${++self.idCounter}`;
                const full: FakeRow = {
                  id,
                  event_id: row.event_id as string,
                  send_id: row.send_id as string,
                  provider: row.provider as string,
                  member_identifier: row.member_identifier as string,
                  fired_at: new Date().toISOString(),
                  dry_run: Boolean(row.dry_run),
                  is_test: isTest,
                  error: null,
                };
                self.rows.push(full);
                return { data: { id }, error: null };
              },
            };
          },
        };
      },
      select(_cols: string) {
        let filtered = [...self.rows];
        const chain = {
          eq(col: string, val: unknown) {
            filtered = filtered.filter((r) => r[col] === val);
            return chain;
          },
          async order(_col: string, _opts: unknown) {
            return { data: filtered, error: null };
          },
        };
        return chain;
      },
    };
  }
}

describe("is_test fires never dedup-lock real fires (migration 144 contract)", () => {
  it("a test claim succeeds even after a real fire already claimed that member", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new FakeAutorespFiresClient() as any;

    const real = await claimAutorespFire(db, {
      eventId: "ev-1",
      sendId: "send-1",
      provider: "mailchimp",
      memberIdentifier: "fan@example.com",
      dryRun: false,
    });
    assert.equal(real.claimed, true);
    assert.equal(real.alreadyFired, false);

    // A second REAL claim for the same member must be rejected (dedup intact).
    const dupeReal = await claimAutorespFire(db, {
      eventId: "ev-1",
      sendId: "send-1",
      provider: "mailchimp",
      memberIdentifier: "fan@example.com",
      dryRun: false,
    });
    assert.equal(dupeReal.claimed, false);
    assert.equal(dupeReal.alreadyFired, true);

    // A TEST claim for the SAME member must succeed — never dedup-blocked.
    const test1 = await claimAutorespFire(db, {
      eventId: "ev-1",
      sendId: "send-1",
      provider: "mailchimp",
      memberIdentifier: "fan@example.com",
      dryRun: false,
      isTest: true,
    });
    assert.equal(test1.claimed, true);
    assert.equal(test1.alreadyFired, false);

    // A SECOND test claim for the same member must also succeed (no dedup at all for test fires).
    const test2 = await claimAutorespFire(db, {
      eventId: "ev-1",
      sendId: "send-1",
      provider: "mailchimp",
      memberIdentifier: "fan@example.com",
      dryRun: false,
      isTest: true,
    });
    assert.equal(test2.claimed, true);
    assert.equal(test2.alreadyFired, false);
  });

  it("a real claim after test claims for the same member is unaffected (never blocked by test fires)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new FakeAutorespFiresClient() as any;

    await claimAutorespFire(db, {
      eventId: "ev-2",
      sendId: "send-2",
      provider: "mailchimp",
      memberIdentifier: "fan2@example.com",
      dryRun: false,
      isTest: true,
    });
    await claimAutorespFire(db, {
      eventId: "ev-2",
      sendId: "send-2",
      provider: "mailchimp",
      memberIdentifier: "fan2@example.com",
      dryRun: false,
      isTest: true,
    });

    const real = await claimAutorespFire(db, {
      eventId: "ev-2",
      sendId: "send-2",
      provider: "mailchimp",
      memberIdentifier: "fan2@example.com",
      dryRun: false,
    });
    assert.equal(real.claimed, true, "real fire must succeed despite prior test fires for the same member");
  });

  it("getAutorespFiresForSend excludes is_test rows from the summary", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new FakeAutorespFiresClient() as any;

    await claimAutorespFire(db, {
      eventId: "ev-3",
      sendId: "send-3",
      provider: "mailchimp",
      memberIdentifier: "real-fan@example.com",
      dryRun: false,
    });
    await claimAutorespFire(db, {
      eventId: "ev-3",
      sendId: "send-3",
      provider: "mailchimp",
      memberIdentifier: "matas@offpixel.co.uk",
      dryRun: false,
      isTest: true,
    });

    const summary = await getAutorespFiresForSend(db, "send-3");
    assert.equal(summary.total, 1, "test fire must not be counted");
    assert.equal(summary.email, 1);
    assert.equal(
      summary.recent.some((r) => r.member_identifier === "matas@offpixel.co.uk"),
      false,
      "test fire must not appear in the recent-fires timeline",
    );
  });
});
