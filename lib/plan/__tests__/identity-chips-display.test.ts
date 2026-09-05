import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyChannelDefaultsRow, resolveChannelDefaults } from "../../clients/channel-defaults.ts";
import {
  identityChipDisplay,
  identityChipEmptyLabel,
  identityChipVisibleLabel,
  lookupStoredName,
  planIdentityChips,
  withIdentityNames,
  type IdentityNameMap,
} from "../identity-chips.ts";

describe("identityChipDisplay", () => {
  it("prefers the name, then the id, then null", () => {
    assert.equal(identityChipDisplay("act_1", "Ironworks Ads"), "Ironworks Ads");
    assert.equal(identityChipDisplay("act_1", null), "act_1");
    assert.equal(identityChipDisplay(null, null), null);
    assert.equal(identityChipDisplay("", "ignored"), null);
  });
});

describe("withIdentityNames", () => {
  it("fills names from the stored map and leaves unknown ids unresolved", () => {
    const chips = planIdentityChips(
      resolveChannelDefaults({
        ...emptyChannelDefaultsRow("ironworks", "Ironworks"),
        metaAdAccountId: "1967530076312",
        metaPixelId: "612345678901234",
        defaultPageId: "page_ironworks",
        googleAdsCustomerId: "123-456-7890",
      }),
    );
    const names: IdentityNameMap = {
      metaAdAccount: { act_1967530076312: "Ironworks Ads" },
      metaPixel: {},
      facebookPage: { page_ironworks: "Ironworks" },
      instagramActor: {},
      tiktokAdvertiser: {},
      tiktokIdentity: {},
      googleCustomer: { "123-456-7890": "Ironworks" },
    };
    const named = withIdentityNames(chips, names);
    const account = named.find((chip) => chip.id === "meta-ad-account");
    const pixel = named.find((chip) => chip.id === "meta-pixel");
    const google = named.find((chip) => chip.id === "google-customer");
    assert.equal(account?.name, "Ironworks Ads");
    assert.equal(identityChipDisplay(account?.value ?? null, account?.name), "Ironworks Ads");
    assert.equal(pixel?.name, null);
    assert.equal(identityChipDisplay(pixel?.value ?? null, pixel?.name), "612345678901234");
    assert.equal(identityChipVisibleLabel(google!), "Ironworks — 123-456-7890");
  });

  it("a missing value stays null — the dashed chip, never empty string", () => {
    const chips = planIdentityChips(
      resolveChannelDefaults(emptyChannelDefaultsRow("ironworks", "Ironworks")),
    );
    for (const chip of chips) {
      assert.equal(chip.value, null);
      assert.equal(identityChipDisplay(chip.value, chip.name), null);
    }
    const byId = Object.fromEntries(chips.map((chip) => [chip.id, chip]));
    assert.equal(identityChipEmptyLabel(byId["tiktok-advertiser"]!), "TikTok account not connected — connect");
    assert.equal(identityChipEmptyLabel(byId["tiktok-identity"]!), "TikTok profile not set — set");
    assert.equal(identityChipEmptyLabel(byId["google-customer"]!), "Google account not connected — connect");
    assert.doesNotMatch(identityChipEmptyLabel(byId["tiktok-advertiser"]!), /\badvertiser\b/);
    assert.doesNotMatch(identityChipEmptyLabel(byId["tiktok-identity"]!), /\bidentity\b/);
    assert.doesNotMatch(identityChipEmptyLabel(byId["google-customer"]!), /\bcustomer\b/);
  });
});

describe("lookupStoredName", () => {
  it("matches act_ and bare Meta ad-account ids", () => {
    const map = { act_1967530076312: "Ironworks Ads" };
    assert.equal(lookupStoredName(map, "act_1967530076312"), "Ironworks Ads");
    assert.equal(lookupStoredName(map, "1967530076312"), "Ironworks Ads");
    assert.equal(lookupStoredName(map, "unknown"), null);
  });
});
