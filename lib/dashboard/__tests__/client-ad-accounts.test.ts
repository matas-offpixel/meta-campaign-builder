import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectClientAdAccountIds } from "../client-ad-accounts.ts";

describe("collectClientAdAccountIds", () => {
  it("puts the event's own account first", () => {
    const ids = collectClientAdAccountIds({
      eventAdAccountId: "1073273492854557",
      clientAdAccountId: "606252931141334",
    });
    assert.deepEqual(ids, ["1073273492854557", "606252931141334"]);
  });

  it("finds the sibling account Fever's spend actually sits in", () => {
    const ids = collectClientAdAccountIds({
      eventAdAccountId: "1073273492854557",
      clientAdAccountId: null,
      siblingEventAdAccountIds: ["606252931141334", "2011069725849568"],
    });
    assert.deepEqual(ids, ["1073273492854557", "606252931141334", "2011069725849568"]);
  });

  it("treats act_123 and 123 as one account", () => {
    const ids = collectClientAdAccountIds({
      eventAdAccountId: "act_606252931141334",
      clientAdAccountId: "606252931141334",
      siblingEventAdAccountIds: ["act_606252931141334"],
    });
    assert.deepEqual(ids, ["act_606252931141334"]);
  });

  it("drops blanks and nulls rather than scanning an empty account", () => {
    const ids = collectClientAdAccountIds({
      eventAdAccountId: null,
      clientAdAccountId: "  ",
      siblingEventAdAccountIds: [null, undefined, "606252931141334"],
    });
    assert.deepEqual(ids, ["606252931141334"]);
  });
});
