import { strict as assert } from "node:assert";
import { test } from "node:test";

import { campaignNameMatchesEventCode } from "../campaign-matching.ts";

test("campaignNameMatchesEventCode matches event_code case-insensitively", () => {
  assert.equal(
    campaignNameMatchesEventCode("YouTube Prospecting [j2-bridge-26]", "J2-BRIDGE-26"),
    true,
  );
  assert.equal(
    campaignNameMatchesEventCode("Search - J2-BRIDGE-26 - Brand", "j2-bridge-26"),
    true,
  );
  assert.equal(
    campaignNameMatchesEventCode("Search - another-event - Brand", "j2-bridge-26"),
    false,
  );
});
