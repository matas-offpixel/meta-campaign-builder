import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertClientSlugMatch,
  ClientScopeError,
  resolveClientMembership,
  type MembershipDb,
} from "../client-context.ts";

/**
 * Phase 1 of the client admin dashboard arc (OP909) — the membership
 * resolution core behind requireClientContext(). Uses the same in-memory
 * fake-DB pattern as lib/landing-pages/__tests__ so the REAL chain runs
 * under node:test without a Supabase connection.
 */

type Row = {
  client_id: string;
  role: string;
  clients: { name: string; slug: string } | null;
};

function fakeDb(rowsByUser: Record<string, Row[]>): MembershipDb {
  return {
    from(table: string) {
      assert.equal(table, "client_users");
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              assert.equal(column, "user_id");
              const rows = rowsByUser[String(value)] ?? [];
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
  };
}

function errorDb(message: string): MembershipDb {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: null, error: { message } });
            },
          };
        },
      };
    },
  };
}

const GMC_ROW: Row = {
  client_id: "2f0dbe34-35ce-4df3-a655-32faa6a0f710",
  role: "owner",
  clients: { name: "GMC Worldwide Productions", slug: "gmc-worldwide-productions" },
};

describe("resolveClientMembership", () => {
  it("happy path — one membership row resolves to the full context", async () => {
    const db = fakeDb({ "user-1": [GMC_ROW] });
    const membership = await resolveClientMembership(db, "user-1");
    assert.deepEqual(membership, {
      userId: "user-1",
      clientId: "2f0dbe34-35ce-4df3-a655-32faa6a0f710",
      clientSlug: "gmc-worldwide-productions",
      clientName: "GMC Worldwide Productions",
      role: "owner",
    });
  });

  it("no membership row → null (operators, revoked clients)", async () => {
    const db = fakeDb({ "user-1": [GMC_ROW] });
    assert.equal(await resolveClientMembership(db, "user-2"), null);
  });

  it("PostgREST array-shaped clients embed is normalised", async () => {
    const arrayRow = {
      ...GMC_ROW,
      clients: [GMC_ROW.clients] as unknown as Row["clients"],
    };
    const db = fakeDb({ "user-1": [arrayRow] });
    const membership = await resolveClientMembership(db, "user-1");
    assert.equal(membership?.clientSlug, "gmc-worldwide-productions");
  });

  it("two rows (broken UNIQUE invariant) → hard throw, never a guess", async () => {
    const db = fakeDb({ "user-1": [GMC_ROW, GMC_ROW] });
    await assert.rejects(
      () => resolveClientMembership(db, "user-1"),
      /Refusing to guess a tenant/,
    );
  });

  it("membership row with an unreadable clients embed → hard throw", async () => {
    const db = fakeDb({ "user-1": [{ ...GMC_ROW, clients: null }] });
    await assert.rejects(
      () => resolveClientMembership(db, "user-1"),
      /resolved no readable clients row/,
    );
  });

  it("query error → throw (never confused with 'no membership')", async () => {
    await assert.rejects(
      () => resolveClientMembership(errorDb("boom"), "user-1"),
      /client_users lookup failed: boom/,
    );
  });
});

describe("assertClientSlugMatch", () => {
  const membership = {
    userId: "user-1",
    clientId: "2f0dbe34-35ce-4df3-a655-32faa6a0f710",
    clientSlug: "gmc-worldwide-productions",
    clientName: "GMC Worldwide Productions",
    role: "owner",
  };

  it("matching slug passes silently", () => {
    assertClientSlugMatch(membership, "gmc-worldwide-productions");
  });

  it("mismatched slug throws ClientScopeError (→ 403, never a redirect)", () => {
    assert.throws(
      () => assertClientSlugMatch(membership, "another-client"),
      (err: unknown) =>
        err instanceof ClientScopeError &&
        /cross-tenant access denied/.test(err.message),
    );
  });
});
