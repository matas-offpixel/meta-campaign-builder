import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors Pixel textarea → payload parsing (see audience-create-form pixelUrlFragmentsForPayload). */
function textareaLinesToFragments(raw: string | string[] | undefined) {
  if (raw === undefined || raw === null) return undefined;
  const lines = Array.isArray(raw) ? raw : String(raw).split("\n");
  const parts = lines.map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

function fragmentsToTextareaValue(raw: string | string[] | undefined): string {
  if (raw == null) return "";
  return Array.isArray(raw) ? raw.join("\n") : raw;
}

describe("pixel URL textarea round-trip", () => {
  it("preserves multiple lines through split and join", () => {
    const typed =
      "https://wearefootballfestival.co.uk\n/tickets/presale";
    const fragments = textareaLinesToFragments(typed);
    assert.deepEqual(fragments, [
      "https://wearefootballfestival.co.uk",
      "/tickets/presale",
    ]);
    const roundTrip = fragmentsToTextareaValue(fragments ?? []);
    assert.equal(roundTrip.split("\n").length, 2);
    assert.ok(roundTrip.includes("wearefootballfestival"));
  });

  it("keeps string[] from collapsing to a single string", () => {
    const arr = ["/a", "/b"];
    const display = fragmentsToTextareaValue(arr);
    const again = textareaLinesToFragments(arr);
    assert.deepEqual(again, ["/a", "/b"]);
    assert.equal(display, "/a\n/b");
  });

  it("preserves a trailing empty line while typing (Enter after first URL)", () => {
    const draftLines = ["https://wearefootballfestival.co.uk", ""];
    const display = fragmentsToTextareaValue(draftLines);
    assert.equal(display, "https://wearefootballfestival.co.uk\n");
    const fragments = textareaLinesToFragments(draftLines);
    assert.deepEqual(fragments, ["https://wearefootballfestival.co.uk"]);
  });
});
