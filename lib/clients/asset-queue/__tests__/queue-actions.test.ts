import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AssetQueueStatus } from "../../../db/asset-queue.ts";
import { decideQueueAction, projectQueueAction, type QueueActionSnapshot } from "../queue-actions.ts";

const OTHER_STATUSES: AssetQueueStatus[] = [
  "pending",
  "matched",
  "matched_umbrella",
  "confirmed",
  "launched",
  "skipped",
];

function row(overrides: Partial<QueueActionSnapshot> & { confirmed_overrides?: Record<string, unknown> | null } = {}) {
  return {
    status: "error" as AssetQueueStatus,
    error_message: "forbidden",
    dropbox_url: "https://www.dropbox.com/scl/fo/example",
    resolved_event_codes_multi: null,
    confirmed_overrides: { primaryText: "keep" } as Record<string, unknown> | null,
    asset_name: "Haiti Fixture",
    generated_copy: "Prepared copy",
    launched_meta_ad_ids: ["ad-1"],
    ...overrides,
  };
}

describe("decideQueueAction", () => {
  it("rejects retry on a non-error row with 409 and no transition", () => {
    for (const status of OTHER_STATUSES) {
      const current = row({
        status,
        error_message: "forbidden",
        dropbox_url: "https://www.dropbox.com/scl/fo/example",
        resolved_event_codes_multi: ["WC26-ABERDEEN"],
      });
      const decision = decideQueueAction(current, "retry");
      assert.equal(decision.statusCode, 409);
      assert.equal(decision.nextStatus, null);
      assert.equal(decision.clearError, false);
      assert.equal(decision.clearOverrides, false);
      assert.equal(decision.rerunPrepare, false);
      assert.equal(projectQueueAction(current, decision), current);
    }
  });

  it("rejects requeue on a non-skipped row with 409 and no transition", () => {
    const statuses: AssetQueueStatus[] = [
      "pending",
      "matched",
      "matched_umbrella",
      "confirmed",
      "launched",
      "error",
    ];
    for (const status of statuses) {
      const current = row({ status, confirmed_overrides: { destUrl: "https://example.com" } });
      const decision = decideQueueAction(current, "requeue");
      assert.equal(decision.statusCode, 409);
      assert.equal(decision.nextStatus, null);
      assert.equal(decision.clearError, false);
      assert.equal(decision.clearOverrides, false);
      assert.equal(decision.rerunPrepare, false);
      assert.equal(projectQueueAction(current, decision), current);
    }
  });

  it("restores a forbidden dropbox error to matched and reruns prepare", () => {
    const current = row({
      status: "error",
      dropbox_url: "https://www.dropbox.com/scl/fo/example",
      error_message: "forbidden",
      resolved_event_codes_multi: null,
    });
    const decision = decideQueueAction(current, "retry");
    assert.equal(decision.statusCode, 200);
    assert.equal(decision.nextStatus, "matched");
    assert.equal(decision.clearError, true);
    assert.equal(decision.clearOverrides, false);
    assert.equal(decision.rerunPrepare, true);
    assert.deepEqual(projectQueueAction(current, decision), {
      ...current,
      status: "matched",
      error_message: null,
    });
  });

  it("restores an umbrella error to matched_umbrella and reruns prepare", () => {
    const current = row({
      status: "error",
      error_message: "storage_upload_failed",
      dropbox_url: "https://www.dropbox.com/scl/fo/example",
      resolved_event_codes_multi: ["WC26-ABERDEEN", "WC26-EDINBURGH"],
    });
    const decision = decideQueueAction(current, "retry");
    assert.equal(decision.statusCode, 200);
    assert.equal(decision.nextStatus, "matched_umbrella");
    assert.equal(decision.rerunPrepare, true);
    assert.equal(decision.clearError, true);
    assert.deepEqual(projectQueueAction(current, decision), {
      ...current,
      status: "matched_umbrella",
      error_message: null,
    });
  });

  it("sends no_venue_mapping back to pending without rerunning prepare", () => {
    const current = row({
      status: "error",
      error_message: "no_venue_mapping",
      dropbox_url: "https://www.dropbox.com/scl/fo/example",
      resolved_event_codes_multi: [],
    });
    const decision = decideQueueAction(current, "retry");
    assert.equal(decision.statusCode, 200);
    assert.equal(decision.nextStatus, "pending");
    assert.equal(decision.clearError, true);
    assert.equal(decision.clearOverrides, false);
    assert.equal(decision.rerunPrepare, false);
    assert.equal(projectQueueAction(current, decision).error_message, null);
  });

  it("requeues a skipped row to pending and clears confirmed_overrides only", () => {
    const current = row({
      status: "skipped",
      error_message: "forbidden",
      dropbox_url: "https://www.dropbox.com/scl/fo/example",
      resolved_event_codes_multi: ["WC26-ABERDEEN"],
      confirmed_overrides: { primaryText: "Modal copy", destUrl: "https://tickets.example.com" },
    });
    const decision = decideQueueAction(current, "requeue");
    assert.equal(decision.statusCode, 200);
    assert.equal(decision.nextStatus, "pending");
    assert.equal(decision.clearError, false);
    assert.equal(decision.clearOverrides, true);
    assert.equal(decision.rerunPrepare, false);
    assert.deepEqual(projectQueueAction(current, decision), {
      ...current,
      status: "pending",
      confirmed_overrides: null,
    });
  });
});

/** Slice from the nearest `{row.status` guard through the labelled button. */
function statusGuardedButton(source: string, label: string): string {
  const close = `>${label}</button>`;
  const at = source.indexOf(close);
  assert.ok(at >= 0, `missing ${label} button`);
  assert.equal(source.indexOf(close, at + close.length), -1, `duplicate ${label} button`);
  const start = source.lastIndexOf("{row.status", at);
  assert.ok(start >= 0, `${label} button has no status guard`);
  return source.slice(start, at + close.length);
}

describe("asset queue patch route", () => {
  const source = readFileSync(
    new URL("../../../../app/api/clients/[id]/asset-queue/[queueId]/route.ts", import.meta.url),
    "utf8",
  );

  it("calls decideQueueAction and reruns prepare only through the prepare POST", () => {
    assert.match(source, /decideQueueAction\(row, action\)/);
    assert.match(source, /from "\.\/prepare\/route"/);
    assert.match(source, /if \(decision\.clearError\) patch\.error_message = null/);
    assert.match(source, /if \(decision\.clearOverrides\) patch\.confirmed_overrides = null/);
    assert.match(source, /if \(decision\.rerunPrepare\)/);
    assert.match(source, /prepareQueueRow\(/);
    assert.match(source, /status: decision\.statusCode/);
  });
});

describe("asset queue panel actions", () => {
  const source = readFileSync(
    new URL("../../../../components/dashboard/clients/asset-queue-panel.tsx", import.meta.url),
    "utf8",
  );

  it("renders Retry only in the error branch and Re-queue only in the skipped branch", () => {
    const retry = statusGuardedButton(source, "Retry");
    const requeue = statusGuardedButton(source, "Re-queue");

    assert.match(retry, /^\{row\.status === "error" && \(/);
    assert.match(requeue, /^\{row\.status === "skipped" && \(/);
    assert.equal(retry.includes("matched"), false);
    assert.equal(retry.includes("pending"), false);
    assert.equal(retry.includes("confirmed"), false);
    assert.equal(retry.includes("launched"), false);
    assert.equal(retry.includes("skipped"), false);
    assert.equal(requeue.includes('"error"'), false);
    assert.equal(requeue.includes("matched"), false);
    assert.equal(requeue.includes("pending"), false);
    assert.equal(requeue.includes("confirmed"), false);
    assert.equal(requeue.includes("launched"), false);

    assert.match(source, /const isCollapsed = row\.status === "launched" \|\| row\.status === "skipped"/);
  });
});
