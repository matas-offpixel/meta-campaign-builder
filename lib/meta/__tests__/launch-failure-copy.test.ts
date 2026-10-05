import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("launch failure copy", () => {
  it("preflight 400 renders the preflight sentence and never the word Meta returned", () => {
    const script = join(import.meta.dirname, "render-launch-failure-lead.ts");
    const out = execFileSync(process.execPath, ["--import", "tsx", script], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
    });
    const report = JSON.parse(out) as {
      preflightSource: string;
      preflightHtml: string;
      metaSource: string;
      metaHtml: string;
    };
    assert.equal(report.preflightSource, "preflight");
    assert.match(
      report.preflightHtml,
      /The launch was stopped before anything was sent to Meta\./,
    );
    assert.equal(report.preflightHtml.includes("Meta returned"), false);
    assert.equal(report.metaSource, "meta");
    assert.match(
      report.metaHtml,
      /Meta returned an error\. Your draft has not been changed\./,
    );
    const dialog = readFileSync(
      join(import.meta.dirname, "../../../components/steps/review-launch.tsx"),
      "utf8",
    );
    assert.match(dialog, /launchFailureLead\(launchErrorSource\)/);
    assert.match(dialog, /max-h-48 overflow-y-auto/);
  });
});
