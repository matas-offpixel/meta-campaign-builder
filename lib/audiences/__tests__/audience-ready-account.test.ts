import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  audienceReadyState,
  foreignAudienceRefusal,
} from "../audience-account.ts";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../meta/__fixtures__/account-scope/custom-audience.json", import.meta.url)),
    "utf8",
  ),
) as { id: string; name: string; account_id: string };

describe("audience ready means this account", () => {
  it("account_id mismatch is not ready and names the account", () => {
    const state = audienceReadyState(
      { readyForLookalike: true, accountId: fixture.account_id },
      "act_606252931141334",
    );
    assert.equal(state.ready, false);
    assert.equal(state.label, "⚠ belongs to act_1073273492854557 — rebuild");
    assert.match(state.label, new RegExp(fixture.account_id));

    const refusal = foreignAudienceRefusal({
      name: fixture.name,
      id: fixture.id,
      audienceAccountId: fixture.account_id,
    });
    assert.match(refusal, new RegExp(fixture.name));
    assert.match(refusal, new RegExp(fixture.id));
    assert.match(refusal, /act_1073273492854557/);
  });

  it("the same account stays ready", () => {
    const state = audienceReadyState(
      { readyForLookalike: true, accountId: fixture.account_id },
      `act_${fixture.account_id}`,
    );
    assert.equal(state.ready, true);
    assert.equal(state.label, "✓ ready");
  });
});
