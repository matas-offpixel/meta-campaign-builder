import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { channelLiveCostLabel } from "../channel-costs.ts";

describe("channel-row live facts (canon £4.21 per thousand)", () => {
  it("formats raw floats through the money formatter", () => {
    assert.equal(
      channelLiveCostLabel({ kind: "amount", value: 4.2067751577548975 }, "thousand"),
      "£4.21 per thousand",
    );
    assert.equal(
      channelLiveCostLabel({ kind: "amount", value: 0.09260564410001461 }, "click"),
      "£0.09 per click",
    );
  });

  it("keeps named empty states as their words", () => {
    assert.equal(channelLiveCostLabel({ kind: "no_clicks_yet" }, "click"), "no clicks yet");
  });
});
