/**
 * Tests for creative-thumbnail ad-account allowlist (event-override fix,
 * Electric Brixton / NX26-DJEZ 2026-08-18).
 *
 * Run: node --test lib/meta/__tests__/thumbnail-ad-account-allowlist.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adAccountMatchesAny,
  loadAllowedAdAccountIdsForClient,
  mergeClientAllowedAdAccountIds,
  type AllowedAdAccountsDb,
} from "../thumbnail-ad-account-allowlist.ts";

/** Electric Brixton client default vs NX Promoter event override (live reproducer). */
const CLIENT_DEFAULT = "1073273492854557";
const NX_OVERRIDE = "606252931141334";
const UNRELATED = "999999999999999";

describe("adAccountMatchesAny — set-based verify", () => {
  const allowed = [CLIENT_DEFAULT, NX_OVERRIDE];

  it("allows an ad whose Graph account_id is a per-event override", () => {
    assert.equal(adAccountMatchesAny(NX_OVERRIDE, allowed), true);
    assert.equal(adAccountMatchesAny(`act_${NX_OVERRIDE}`, allowed), true);
  });

  it("allows an ad in the client default account", () => {
    assert.equal(adAccountMatchesAny(CLIENT_DEFAULT, allowed), true);
    assert.equal(adAccountMatchesAny(`act_${CLIENT_DEFAULT}`, allowed), true);
  });

  it("rejects an ad in an unrelated ad account (still 403)", () => {
    assert.equal(adAccountMatchesAny(UNRELATED, allowed), false);
    assert.equal(adAccountMatchesAny(`act_${UNRELATED}`, allowed), false);
  });

  it("rejects when the allowlist is empty", () => {
    assert.equal(adAccountMatchesAny(NX_OVERRIDE, []), false);
  });
});

describe("mergeClientAllowedAdAccountIds", () => {
  it("unions client default with DISTINCT event overrides (bare ids)", () => {
    assert.deepEqual(
      mergeClientAllowedAdAccountIds(CLIENT_DEFAULT, [
        NX_OVERRIDE,
        NX_OVERRIDE, // duplicate event rows
        `act_${NX_OVERRIDE}`, // act_ form of same override
        null,
        "  ",
      ]),
      [CLIENT_DEFAULT, NX_OVERRIDE],
    );
  });

  it("returns empty when nothing is configured (placeholder path)", () => {
    assert.deepEqual(mergeClientAllowedAdAccountIds(null, [null, undefined]), []);
  });
});

describe("loadAllowedAdAccountIdsForClient — share-token path resolving allowlist", () => {
  it("resolves client default + event overrides for the share's client_id", async () => {
    const seenClientIds: string[] = [];
    const db: AllowedAdAccountsDb = {
      async getClientMetaAdAccountId(clientId) {
        seenClientIds.push(`client:${clientId}`);
        assert.equal(clientId, "client-electric-brixton");
        return CLIENT_DEFAULT;
      },
      async listEventMetaAdAccountIds(clientId) {
        seenClientIds.push(`events:${clientId}`);
        assert.equal(clientId, "client-electric-brixton");
        // Four NX events all override to the same NX Promoter account.
        return [NX_OVERRIDE, NX_OVERRIDE, NX_OVERRIDE, NX_OVERRIDE];
      },
    };

    const allowed = await loadAllowedAdAccountIdsForClient(
      db,
      "client-electric-brixton",
    );

    assert.deepEqual(allowed, [CLIENT_DEFAULT, NX_OVERRIDE]);
    assert.deepEqual(seenClientIds, [
      "client:client-electric-brixton",
      "events:client-electric-brixton",
    ]);
    // Set-based verify: NX ad passes, unrelated still fails.
    assert.equal(adAccountMatchesAny(NX_OVERRIDE, allowed), true);
    assert.equal(adAccountMatchesAny(UNRELATED, allowed), false);
  });
});
