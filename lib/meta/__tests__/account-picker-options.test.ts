import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  UNNAMED_ACCOUNT_LABEL,
  UNNAMED_PIXEL_LABEL,
  metaAdAccountPickerOptions,
  metaPixelPickerOptions,
  pickerOptionMatches,
} from "../account-picker-options.ts";

const ACCOUNTS = [
  { id: "act_14241187", account_id: "14241187", name: "14241187" },
  { id: "act_58405867", account_id: "58405867", name: "The Nest" },
  { id: "act_116881966", account_id: "116881966", name: "116881966" },
  { id: "act_900", account_id: "900", name: "Phonox (Read-Only)" },
  { id: "act_800", account_id: "800", name: "AMAAD / LWE" },
  { id: "act_700", account_id: "700", name: "  " },
];

describe("meta ad account picker rows", () => {
  const options = metaAdAccountPickerOptions(ACCOUNTS);

  it("keeps the id the select saved", () => {
    assert.deepEqual(
      options.map((row) => row.value),
      ["act_800", "act_900", "act_58405867", "act_116881966", "act_14241187", "act_700"],
    );
  });

  it("is alphabetical by name, with unnamed accounts last", () => {
    assert.deepEqual(
      options.map((row) => row.label),
      [
        "AMAAD / LWE",
        "Phonox (Read-Only)",
        "The Nest",
        UNNAMED_ACCOUNT_LABEL,
        UNNAMED_ACCOUNT_LABEL,
        UNNAMED_ACCOUNT_LABEL,
      ],
    );
  });

  it("names the account and puts the id underneath", () => {
    const nest = options.find((row) => row.value === "act_58405867");
    assert.equal(nest?.label, "The Nest");
    assert.equal(nest?.sublabel, "act_58405867");
  });

  it("says unnamed instead of printing the id twice", () => {
    const unnamed = options.find((row) => row.value === "act_14241187");
    assert.equal(unnamed?.label, UNNAMED_ACCOUNT_LABEL);
    assert.equal(unnamed?.sublabel, "act_14241187");
    assert.equal(unnamed?.label.includes("14241187"), false);
  });

  it("keeps the Read-Only marker", () => {
    const phonox = options.find((row) => row.value === "act_900");
    assert.match(phonox?.label ?? "", /\(Read-Only\)/);
  });

  it("filters on name, bare id, and the act_ form", () => {
    assert.deepEqual(
      options.filter((row) => pickerOptionMatches(row, "nest")).map((row) => row.value),
      ["act_58405867"],
    );
    assert.deepEqual(
      options.filter((row) => pickerOptionMatches(row, "14241187")).map((row) => row.value),
      ["act_14241187"],
    );
    assert.deepEqual(
      options.filter((row) => pickerOptionMatches(row, "act_14241187")).map((row) => row.value),
      ["act_14241187"],
    );
    assert.deepEqual(
      options.filter((row) => pickerOptionMatches(row, "read-only")).map((row) => row.value),
      ["act_900"],
    );
  });

  it("puts Read-Only on the sublabel when the account has no name", () => {
    const [row] = metaAdAccountPickerOptions([
      { id: "act_1", account_id: "1", name: "1 (Read-Only)" },
    ]);
    assert.equal(row?.label, UNNAMED_ACCOUNT_LABEL);
    assert.match(row?.sublabel ?? "", /act_1/);
    assert.match(row?.sublabel ?? "", /\(Read-Only\)/);
    assert.equal(row?.value, "act_1");
  });
});

describe("converted pickers use Combobox", () => {
  const combobox = readFileSync(
    new URL("../../../components/ui/combobox.tsx", import.meta.url),
    "utf8",
  );

  it("the combobox renders a search input", () => {
    assert.match(combobox, /placeholder="Search…"/);
    assert.match(combobox, /<input/);
  });

  for (const file of [
    "components/meta/meta-import-picker.tsx",
    "components/steps/account-setup.tsx",
    "components/audiences/source-picker.tsx",
    "components/intelligence/creative-heatmap.tsx",
    "app/(dashboard)/audiences/[clientId]/clone-saved/clone-form.tsx",
  ]) {
    it(`${file} builds rows with the helper and renders Combobox`, () => {
      const src = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
      assert.match(src, /<Combobox/);
      assert.match(src, /meta(AdAccount|Pixel)PickerOptions/);
      assert.equal(src.includes("<select"), false);
    });
  }
});

describe("meta pixel picker rows", () => {
  it("names the pixel, sorts it, and keeps the id as the value", () => {
    const options = metaPixelPickerOptions([
      { id: "px_2", name: "px_2" },
      { id: "px_1", name: "Checkout" },
    ]);
    assert.deepEqual(
      options.map((row) => ({ value: row.value, label: row.label, sublabel: row.sublabel })),
      [
        { value: "px_1", label: "Checkout", sublabel: "px_1" },
        { value: "px_2", label: UNNAMED_PIXEL_LABEL, sublabel: "px_2" },
      ],
    );
    assert.equal(pickerOptionMatches(options[0]!, "checkout"), true);
    assert.equal(pickerOptionMatches(options[1]!, "px_2"), true);
  });
});
