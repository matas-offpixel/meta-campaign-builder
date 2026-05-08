import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Mirrors the button label progression in VenueReportHeader after a
 * successful POST /api/share/client (tests the intent, not React).
 */
function shareButtonLabel(
  kind: "editable" | "view" | null,
  busy: boolean,
): string {
  if (busy) return "Sharing…";
  if (kind === "editable") return "Share (editable)";
  if (kind === "view") return "Share (view-only)";
  return "Share";
}

describe("venue client share button label", () => {
  it("shows Sharing… while busy", () => {
    assert.equal(shareButtonLabel(null, true), "Sharing…");
  });

  it("shows editability after mint", () => {
    assert.equal(shareButtonLabel("editable", false), "Share (editable)");
    assert.equal(shareButtonLabel("view", false), "Share (view-only)");
  });
});
