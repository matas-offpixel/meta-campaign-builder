import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTestEmailAudience, resolveTestSendContent } from "../resolve.ts";

describe("resolveTestSendContent", () => {
  it("prefers the rendered per-milestone copy over the template", () => {
    const result = resolveTestSendContent({
      jobType: "announce",
      copyBundle: { announce: { subject: "Copy subject", body_markdown: "Copy body" } },
      templateSubject: "Template subject",
      templateBodyMarkdown: "Template body",
    });
    assert.deepEqual(result, { subject: "[TEST] Copy subject", bodyMarkdown: "Copy body" });
  });

  it("falls back to the template when copy is absent for this job_type", () => {
    const result = resolveTestSendContent({
      jobType: "reminder",
      copyBundle: { announce: { body_markdown: "unrelated" } },
      templateSubject: "Template subject",
      templateBodyMarkdown: "Template body",
    });
    assert.deepEqual(result, { subject: "[TEST] Template subject", bodyMarkdown: "Template body" });
  });

  it("falls back to the template when jobType is null", () => {
    const result = resolveTestSendContent({
      jobType: null,
      copyBundle: { announce: { body_markdown: "unrelated" } },
      templateSubject: "Template subject",
      templateBodyMarkdown: "Template body",
    });
    assert.deepEqual(result, { subject: "[TEST] Template subject", bodyMarkdown: "Template body" });
  });

  it("uses '(no subject)' when neither copy nor template has a subject", () => {
    const result = resolveTestSendContent({
      jobType: "announce",
      copyBundle: null,
      templateSubject: null,
      templateBodyMarkdown: "Body only",
    });
    assert.deepEqual(result, { subject: "[TEST] (no subject)", bodyMarkdown: "Body only" });
  });

  it("returns null when there is no body anywhere (never sends an empty test)", () => {
    const result = resolveTestSendContent({
      jobType: "announce",
      copyBundle: { announce: { body_markdown: "" } },
      templateSubject: "Has a subject",
      templateBodyMarkdown: "   ",
    });
    assert.equal(result, null);
  });

  it("treats a copy body of only whitespace as absent (falls back to template)", () => {
    const result = resolveTestSendContent({
      jobType: "announce",
      copyBundle: { announce: { body_markdown: "" } },
      templateSubject: null,
      templateBodyMarkdown: "Template body wins",
    });
    assert.deepEqual(result, { subject: "[TEST] (no subject)", bodyMarkdown: "Template body wins" });
  });
});

describe("buildTestEmailAudience", () => {
  it("targets the ephemeral segment and drops tag targeting", () => {
    const audience = buildTestEmailAudience(
      { list_id: "old-list", reply_to: "events@offpixel.co.uk", from_name: "Events", tags: ["vip"], tag: "vip" },
      { listId: "LIST1", savedSegmentId: 4471, sendId: "send-1", nowMs: 123 },
    );
    assert.equal(audience.list_id, "LIST1");
    assert.equal(audience.saved_segment_id, 4471);
    assert.equal(audience.send_now, true);
    assert.equal(audience.campaign_title, "test-send-1-123");
    assert.equal(audience.reply_to, "events@offpixel.co.uk");
    assert.equal(audience.from_name, "Events");
    assert.equal("tags" in audience, false, "must never target the real tag audience");
    assert.equal("tag" in audience, false, "must never target the real tag audience");
  });

  it("does not mutate the base audience object", () => {
    const base = { list_id: "old-list", tags: ["vip"] };
    buildTestEmailAudience(base, { listId: "LIST1", savedSegmentId: 1, sendId: "s", nowMs: 1 });
    assert.deepEqual(base, { list_id: "old-list", tags: ["vip"] });
  });
});
