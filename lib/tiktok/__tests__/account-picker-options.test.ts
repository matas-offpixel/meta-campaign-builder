import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// pickerOptionMatches mirrors the Combobox filter haystack; the Combobox
// filter itself is not reimplemented here.
import {
  UNNAMED_ACCOUNT_LABEL as META_UNNAMED_ACCOUNT_LABEL,
  UNNAMED_PIXEL_LABEL as META_UNNAMED_PIXEL_LABEL,
  pickerOptionMatches,
} from "../../meta/account-picker-options.ts";
import {
  UNNAMED_ACCOUNT_LABEL,
  UNNAMED_PIXEL_LABEL,
  tikTokAdvertiserPickerOptions,
  tikTokAdvertiserSelectionPatch,
  tikTokPixelPickerOptions,
  tikTokPixelSelectionPatch,
} from "../account-picker-options.ts";

const ACCOUNTS = [
  { id: "a1f0c2d4-0000-4000-8000-00000000000a", account_name: "Ironworks London", tiktok_advertiser_id: "7412345678901234567" },
  { id: "b2e1d3c5-0000-4000-8000-00000000000b", account_name: "Black Butter", tiktok_advertiser_id: "7298765432109876543" },
  { id: "c3d2e4f6-0000-4000-8000-00000000000c", account_name: "7100000000000000001", tiktok_advertiser_id: "7100000000000000001" },
  { id: "d4c3f5a7-0000-4000-8000-00000000000d", account_name: "  ", tiktok_advertiser_id: "7200000000000000002" },
  { id: "e5b4a6b8-0000-4000-8000-00000000000e", account_name: "Not connected", tiktok_advertiser_id: null },
];

/** The `options` the old `<Select id="tiktok-advertiser">` built. */
function oldSelectOptions(accounts: typeof ACCOUNTS) {
  return accounts
    .filter((account) => Boolean(account.tiktok_advertiser_id))
    .map((account) => ({
      value: account.id,
      label: `${account.account_name} (${account.tiktok_advertiser_id})`,
    }));
}

/** The object the old inline `saveAccount` passed to `persist`. */
function oldSaveAccountPatch(accounts: typeof ACCOUNTS, accountId: string) {
  const account = accounts.find((candidate) => candidate.id === accountId);
  return {
    tiktokAccountId: account?.id ?? null,
    advertiserId: account?.tiktok_advertiser_id ?? null,
    identityId: null,
    identityDisplayName: null,
    identityManualName: null,
    identityBcId: null,
    identityType: null,
    pixelId: null,
    pixelName: null,
    optimisationEvent: null,
    currency: null,
  };
}

describe("tiktok advertiser picker rows", () => {
  const options = tikTokAdvertiserPickerOptions(ACCOUNTS);

  it("uses the Meta unnamed strings", () => {
    assert.equal(UNNAMED_ACCOUNT_LABEL, META_UNNAMED_ACCOUNT_LABEL);
    assert.equal(UNNAMED_PIXEL_LABEL, META_UNNAMED_PIXEL_LABEL);
  });

  it("labels each row name + advertiser id, unnamed last", () => {
    assert.deepEqual(
      options.map((row) => row.label),
      [
        "Black Butter (7298765432109876543)",
        "Ironworks London (7412345678901234567)",
        `${UNNAMED_ACCOUNT_LABEL} (7100000000000000001)`,
        `${UNNAMED_ACCOUNT_LABEL} (7200000000000000002)`,
      ],
    );
  });

  it("offers the same values the old select offered", () => {
    assert.deepEqual(
      options.map((row) => row.value).sort(),
      oldSelectOptions(ACCOUNTS).map((row) => row.value).sort(),
    );
  });

  it("puts the advertiser id in keywords", () => {
    const ironworks = options.find((row) => row.label.startsWith("Ironworks"));
    assert.match(ironworks?.keywords ?? "", /7412345678901234567/);
    assert.match(ironworks?.keywords ?? "", /Ironworks London/);
  });

  it("narrows on a pasted advertiser id and on a name fragment", () => {
    assert.deepEqual(
      options.filter((row) => pickerOptionMatches(row, "7412345678901234567")).map((row) => row.value),
      ["a1f0c2d4-0000-4000-8000-00000000000a"],
    );
    assert.deepEqual(
      options.filter((row) => pickerOptionMatches(row, "butter")).map((row) => row.value),
      ["b2e1d3c5-0000-4000-8000-00000000000b"],
    );
  });
});

describe("picking a tiktok advertiser stores what the select stored", () => {
  it("golden: tiktokAccountId is the tiktok_accounts row id, byte for byte", () => {
    const row = tikTokAdvertiserPickerOptions(ACCOUNTS).find((option) =>
      option.label.startsWith("Ironworks London"),
    );
    assert.ok(row);
    const patch = tikTokAdvertiserSelectionPatch(ACCOUNTS, row.value);
    assert.equal(patch.tiktokAccountId, "a1f0c2d4-0000-4000-8000-00000000000a");
    assert.equal(patch.advertiserId, "7412345678901234567");
  });

  it("the whole accountSetup patch equals the old inline one for every row", () => {
    for (const row of tikTokAdvertiserPickerOptions(ACCOUNTS)) {
      assert.deepEqual(
        tikTokAdvertiserSelectionPatch(ACCOUNTS, row.value),
        oldSaveAccountPatch(ACCOUNTS, row.value),
      );
    }
  });
});

const PIXELS = [
  { pixel_id: "CQ7ABC1234567890", pixel_name: "Checkout", status: "ACTIVE" },
  { pixel_id: "CR8DEF0987654321", pixel_name: "", status: null },
];

describe("tiktok pixel picker rows", () => {
  const options = tikTokPixelPickerOptions(PIXELS);

  it("labels name + pixel id, status underneath, unnamed fallback", () => {
    assert.deepEqual(options, [
      {
        value: "CQ7ABC1234567890",
        label: "Checkout (CQ7ABC1234567890)",
        sublabel: "ACTIVE",
        keywords: "Checkout CQ7ABC1234567890",
      },
      {
        value: "CR8DEF0987654321",
        label: `${UNNAMED_PIXEL_LABEL} (CR8DEF0987654321)`,
        sublabel: undefined,
        keywords: "CR8DEF0987654321",
      },
    ]);
  });

  it("stores the same pixelId and pixelName the select stored", () => {
    assert.deepEqual(tikTokPixelSelectionPatch(PIXELS, "CQ7ABC1234567890"), {
      pixelId: "CQ7ABC1234567890",
      pixelName: "Checkout",
      optimisationEvent: null,
    });
  });
});

describe("account-setup renders the Comboboxes", () => {
  const src = readFileSync(
    new URL("../../../components/tiktok-wizard/steps/account-setup.tsx", import.meta.url),
    "utf8",
  );

  it("advertiser and pixel are Comboboxes built from the helper", () => {
    assert.match(src, /<Combobox[\s\S]*?label="TikTok advertiser"[\s\S]*?tikTokAdvertiserPickerOptions\(accounts\)/);
    assert.match(src, /<Combobox[\s\S]*?label="TikTok pixel"[\s\S]*?tikTokPixelPickerOptions\(pixels\)/);
    assert.equal(src.includes('id="tiktok-advertiser"'), false);
    assert.equal(src.includes('id="tiktok-pixel"'), false);
  });

  it("identity type and optimisation event stay plain selects", () => {
    assert.match(src, /<Select\s+id="tiktok-manual-identity-type"/);
    assert.match(src, /<Select\s+id="tiktok-optimisation-event"/);
  });
});
