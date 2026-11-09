import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { judgeOverlay, overlayErrorClass, overlayLogLine } from "../overlay-run.ts";

const SIGNED = "https://example.supabase.co/storage/v1/object/sign/campaign-assets/u/clip.mp4?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
const TIMES = [0.5, 4, 8];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

function capture(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

describe("overlay check failures are logged", () => {
  it("logs the stage and the class when the Lambda site has no FrameSheet composition, and stores check by eye", async () => {
    const { lines, log } = capture();
    const result = await judgeOverlay({
      src: SIGNED,
      times: TIMES,
      thumbnail: null,
      log,
      sheet: async () => {
        throw new Error(
          "Error: Could not find composition with ID FrameSheet. Available compositions: 4tfCityStatic, PhotoReelStatic, CaptionOnClip\n    at window.remotion_calculateComposition (https://remotionlambda-euwest2-x.s3.eu-west-2.amazonaws.com/sites/creative-lab/bundle.js:1:1)",
        );
      },
    });
    assert.equal(result.unsure, true);
    assert.equal(result.reason, "Check this one by eye.");
    assert.equal(result.lambdaCostUsd, null);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]!), {
      check: "overlay",
      verdict: "check_by_eye",
      stage: "sheet",
      errorClass: "Could not find composition with ID FrameSheet",
    });
    assert.doesNotMatch(lines[0]!, /amazonaws|https?:/);
  });

  it("never puts a signed URL, a token or a key in the line", async () => {
    const { lines, log } = capture();
    await judgeOverlay({
      src: SIGNED,
      times: TIMES,
      thumbnail: null,
      log,
      sheet: async (src) => {
        throw new Error(`Failed to fetch ${src} with key AKIAABCDEFGHIJKLMNOP and sk-ant-api03-abcdefghijklmnop`);
      },
    });
    assert.equal(lines.length, 1);
    const line = lines[0]!;
    assert.doesNotMatch(line, /supabase|token=|eyJ|AKIA|sk-ant/);
    assert.equal(JSON.parse(line).errorClass, "Failed to fetch <url> with key <key> and <key>");
  });

  it("tags a model failure as the model stage and keeps the Lambda cost that was spent", async () => {
    class NotFoundError extends Error {
      override name = "NotFoundError";
    }
    const { lines, log } = capture();
    const result = await judgeOverlay({
      src: SIGNED,
      times: TIMES,
      thumbnail: null,
      log,
      sheet: async () => ({ bytes: JPEG, estimatedCostUsd: 0.0012 }),
      ask: async () => {
        throw new NotFoundError('404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-x"}}');
      },
    });
    assert.equal(result.unsure, true);
    assert.equal(result.lambdaCostUsd, 0.0012);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.stage, "model");
    assert.match(parsed.errorClass, /^NotFoundError: 404 /);
  });

  it("logs a missing source as the source stage without calling Lambda", async () => {
    const { lines, log } = capture();
    let called = false;
    const result = await judgeOverlay({
      src: null,
      times: TIMES,
      thumbnail: null,
      log,
      sheet: async () => {
        called = true;
        return { bytes: JPEG, estimatedCostUsd: 0 };
      },
    });
    assert.equal(called, false);
    assert.equal(result.unsure, true);
    assert.equal(JSON.parse(lines[0]!).stage, "source");
  });

  it("writes no line when the check returns a verdict", async () => {
    const { lines, log } = capture();
    const result = await judgeOverlay({
      src: SIGNED,
      times: TIMES,
      thumbnail: JPEG,
      log,
      sheet: async () => ({ bytes: JPEG, estimatedCostUsd: 0.001 }),
      ask: async (images) => {
        assert.equal(images.length, 2);
        return { verdict: "text_overlay", frames: [{ t: 0.5, text: true, what: "date" }], reason: "date on every frame" };
      },
    });
    assert.equal(result.verdict, "text_overlay");
    assert.equal(result.lambdaCostUsd, 0.001);
    assert.deepEqual(lines, []);
  });
});

describe("overlay error class", () => {
  it("drops the stack, a leading Error:, and everything after the first sentence", () => {
    assert.equal(overlayErrorClass(new Error("Error: Lambda render timed out. Retry later\n at x")), "Lambda render timed out");
    assert.equal(overlayErrorClass("plain string failure"), "plain string failure");
    assert.equal(overlayErrorClass(null), "unknown");
    assert.equal(overlayErrorClass(new Error("")), "unknown");
  });

  it("is one JSON line", () => {
    const line = overlayLogLine({ stage: "download", error: new Error("frame sheet download returned 403") });
    assert.equal(line.includes("\n"), false);
    assert.equal(JSON.parse(line).errorClass, "frame sheet download returned 403");
  });
});

describe("the frame sheet composition", () => {
  it("is registered under the id the still asks for", () => {
    const lambda = readFileSync(new URL("../lambda.ts", import.meta.url), "utf8");
    const index = readFileSync(new URL("../../../src/remotion/index.tsx", import.meta.url), "utf8");
    assert.match(lambda, /composition: "FrameSheet"/);
    assert.match(index, /id="FrameSheet"/);
  });
});
