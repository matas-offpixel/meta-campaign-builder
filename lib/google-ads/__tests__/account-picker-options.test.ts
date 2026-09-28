import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// pickerOptionMatches mirrors the Combobox filter haystack; the Combobox
// filter itself is not reimplemented here.
import {
  UNNAMED_ACCOUNT_LABEL as META_UNNAMED_ACCOUNT_LABEL,
  pickerOptionMatches,
} from "../../meta/account-picker-options.ts";
import {
  UNNAMED_ACCOUNT_LABEL,
  googleAdsAccountPickerOptions,
  googlePickerStoredId,
  googleSearchEventPickerOptions,
} from "../account-picker-options.ts";

/** Customer ids in the form `google_ads_accounts.google_customer_id` holds today. */
const ACCOUNTS = [
  { id: "0a1b2c3d-1111-4aaa-8bbb-000000000001", account_name: "Black Butter", google_customer_id: "288-501-5945" },
  { id: "0a1b2c3d-1111-4aaa-8bbb-000000000002", account_name: "Ironworks London", google_customer_id: "839-818-3094" },
  { id: "0a1b2c3d-1111-4aaa-8bbb-000000000003", account_name: "LWE", google_customer_id: "324-410-8450" },
  { id: "0a1b2c3d-1111-4aaa-8bbb-000000000004", account_name: "Off/Pixel", google_customer_id: "793-280-0197" },
  { id: "0a1b2c3d-1111-4aaa-8bbb-000000000005", account_name: "Off/Pixel Manager Account", google_customer_id: "333-703-8088" },
  { id: "0a1b2c3d-1111-4aaa-8bbb-000000000006", account_name: null, google_customer_id: "5550001234" },
];

const MCC = "0a1b2c3d-1111-4aaa-8bbb-000000000005";

function matching(query: string) {
  return googleAdsAccountPickerOptions(ACCOUNTS)
    .filter((row) => pickerOptionMatches(row, query))
    .map((row) => row.value);
}

describe("google ads account picker rows", () => {
  const options = googleAdsAccountPickerOptions(ACCOUNTS);

  it("uses the Meta unnamed string", () => {
    assert.equal(UNNAMED_ACCOUNT_LABEL, META_UNNAMED_ACCOUNT_LABEL);
  });

  it("labels name + customer id as stored, unnamed last", () => {
    assert.deepEqual(
      options.map((row) => row.label),
      [
        "Black Butter (288-501-5945)",
        "Ironworks London (839-818-3094)",
        "LWE (324-410-8450)",
        "Off/Pixel (793-280-0197)",
        "Off/Pixel Manager Account (333-703-8088)",
        `${UNNAMED_ACCOUNT_LABEL} (5550001234)`,
      ],
    );
  });

  it("keywords hold the customer id with and without dashes", () => {
    const mcc = options.find((row) => row.value === MCC);
    assert.equal(mcc?.keywords, "Off/Pixel Manager Account 333-703-8088 3337038088");
    const unnamed = options.find((row) => row.value.endsWith("006"));
    assert.equal(unnamed?.keywords, "5550001234 555-000-1234");
  });

  it("an account with no customer id keeps the old dash placeholder", () => {
    const [row] = googleAdsAccountPickerOptions([
      { id: "x", account_name: "Pending", google_customer_id: null },
    ]);
    assert.equal(row?.label, "Pending (—)");
  });

  it('typing "333" narrows to the MCC and nothing else', () => {
    assert.deepEqual(matching("333"), [MCC]);
  });

  it("the MCC matches its id pasted dashed or undashed", () => {
    assert.deepEqual(matching("3337038088"), [MCC]);
    assert.deepEqual(matching("333-703-8088"), [MCC]);
  });

  it("an undashed stored id matches a dashed paste", () => {
    assert.deepEqual(matching("555-000-1234"), ["0a1b2c3d-1111-4aaa-8bbb-000000000006"]);
  });
});

describe("picking a google ads account stores what the select stored", () => {
  it("golden: google_ads_account_id is the row id, not a reformatted customer id", () => {
    const row = googleAdsAccountPickerOptions(ACCOUNTS).find((option) =>
      option.label.startsWith("Off/Pixel Manager Account"),
    );
    assert.ok(row);
    assert.equal(googlePickerStoredId(row.value), "0a1b2c3d-1111-4aaa-8bbb-000000000005");
  });

  it("every row value is the same string the old select option carried", () => {
    const oldValues = ACCOUNTS.map((a) => a.id).sort();
    assert.deepEqual(
      googleAdsAccountPickerOptions(ACCOUNTS).map((row) => row.value).sort(),
      oldValues,
    );
  });

  it("the empty row still clears to null", () => {
    assert.equal(googlePickerStoredId(""), null);
  });
});

describe("google search event picker rows", () => {
  const events = [
    { id: "ev-2", name: "Junction 2 Melodic", event_code: "J2M26" },
    { id: "ev-1", name: "Black Butter Summer", event_code: null },
  ];

  it("keeps the old labels, values, and order", () => {
    assert.deepEqual(
      googleSearchEventPickerOptions(events).map(({ value, label }) => ({ value, label })),
      [
        { value: "ev-2", label: "Junction 2 Melodic (J2M26)" },
        { value: "ev-1", label: "Black Butter Summer" },
      ],
    );
  });

  it("filters on event code", () => {
    assert.deepEqual(
      googleSearchEventPickerOptions(events)
        .filter((row) => pickerOptionMatches(row, "j2m"))
        .map((row) => row.value),
      ["ev-2"],
    );
  });
});

describe("google search pickers render Comboboxes", () => {
  const read = (file: string) =>
    readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

  it("plan-actions: event and account are Comboboxes, structure stays a select", () => {
    const src = read("components/google-search/plan-actions.tsx");
    assert.match(src, /googleSearchEventPickerOptions\(events\)/);
    assert.match(src, /googleAdsAccountPickerOptions\(accounts\)/);
    assert.equal((src.match(/<Combobox/g) ?? []).length, 2);
    assert.equal((src.match(/<select/g) ?? []).length, 1);
    assert.match(src, /<select\s+value=\{structureMode\}/);
  });

  it("plan-setup (drawer + standalone): event and account are Comboboxes", () => {
    const src = read("components/google-search-wizard/steps/plan-setup.tsx");
    assert.match(src, /googleSearchEventPickerOptions\(context\.events\)/);
    assert.match(src, /googleAdsAccountPickerOptions\(context\.googleAdsAccounts\)/);
    assert.equal(src.includes('id="gs-plan-event"'), false);
    assert.equal(src.includes('id="gs-plan-account"'), false);
    assert.match(src, /id="gs-plan-structure"/);
    assert.match(src, /id="gs-plan-bidding"/);
  });
});
