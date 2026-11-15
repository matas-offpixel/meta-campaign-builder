import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CaptionRenderRequest } from "../render.ts";
import {
  MAX_FUNCTIONS_PER_CAPTION_RENDER,
  MAX_LAB_RENDERS_AT_ONCE,
  MIN_FRAMES_PER_LAMBDA,
  lambdaChunking,
  pickLambdaFunction,
  renderCaptionViaLambda,
  renderFrameSheetStill,
  requireLambdaServeUrl,
  type LambdaDeps,
} from "../lambda.ts";

const FN = { functionName: "remotion-render-4-0-471-mem2048mb-disk2048mb-480sec", timeoutInSeconds: 480 };

function request(seconds: number, fps = 30): CaptionRenderRequest {
  return {
    props: { clipUrl: "https://example.test/clip.mp4", lines: ["a"], inS: 0, outS: seconds, fps, durationInSeconds: seconds } as unknown as CaptionRenderRequest["props"],
    muted: false,
  };
}

/** Records every Remotion call. One poll returns done. */
function fakeClient(calls: { name: string; input: Record<string, unknown> }[]): NonNullable<LambdaDeps["client"]> {
  const record = (name: string) => (input: unknown) => {
    calls.push({ name, input: input as Record<string, unknown> });
  };
  return {
    getFunctions: (async (input: unknown) => {
      record("getFunctions")(input);
      return [FN];
    }) as never,
    renderMediaOnLambda: (async (input: unknown) => {
      record("renderMediaOnLambda")(input);
      return { bucketName: "remotionlambda-test", renderId: "r1" };
    }) as never,
    getRenderProgress: (async (input: unknown) => {
      record("getRenderProgress")(input);
      return { done: true, fatalErrorEncountered: false, errors: [], outBucket: "remotionlambda-test", outKey: "renders/r1/out.mp4", costs: { accruedSoFar: 0.0126, displayCost: "$0.013" } };
    }) as never,
    deleteRender: (async (input: unknown) => {
      record("deleteRender")(input);
    }) as never,
    renderStillOnLambda: (async (input: unknown) => {
      record("renderStillOnLambda")(input);
      return { url: "https://example.test/sheet.jpg", estimatedPrice: { accruedSoFar: 0.00018 } };
    }) as never,
  };
}


describe("lambda chunking", () => {
  it("renders in one function when the concurrency quota is 10 or lower", () => {
    assert.deepEqual(lambdaChunking(10, 591), { framesPerLambda: 591, concurrencyPerLambda: 1, singleFunction: true });
    assert.equal(lambdaChunking(8, 30).singleFunction, true);
  });

  it("caps a caption render at 20 functions under the 1000 quota", () => {
    assert.equal(MAX_FUNCTIONS_PER_CAPTION_RENDER, 20);
    assert.equal(MIN_FRAMES_PER_LAMBDA, 20);
    // 30 s at 30 fps, the Lab's longest clip: Remotion's default would be 45 functions.
    assert.deepEqual(lambdaChunking(1000, 900), { framesPerLambda: 45, singleFunction: false });
    // The measured 26 s clip at 25 fps: 33 frames each, 20 chunks.
    assert.deepEqual(lambdaChunking(1000, 653), { framesPerLambda: 33, singleFunction: false });
    for (const frames of [1, 50, 400, 653, 900, 1800, 3600]) {
      const { framesPerLambda } = lambdaChunking(1000, frames);
      assert.ok(Math.ceil(frames / framesPerLambda!) <= MAX_FUNCTIONS_PER_CAPTION_RENDER, `${frames} frames`);
    }
  });

  it("keeps a short clip on few functions", () => {
    // 2 s at 25 fps: 3 functions, the same split Remotion chose in the measurement.
    assert.deepEqual(lambdaChunking(1000, 50), { framesPerLambda: 20, singleFunction: false });
    assert.equal(Math.ceil(50 / 20), 3);
    assert.deepEqual(lambdaChunking(1000, 12), { framesPerLambda: 20, singleFunction: false });
  });

  it("starts at most 4 Lab renders at once", () => {
    assert.equal(MAX_LAB_RENDERS_AT_ONCE, 4);
    assert.ok(MAX_LAB_RENDERS_AT_ONCE * (MAX_FUNCTIONS_PER_CAPTION_RENDER + 1) <= 100);
  });

  it("uses the 480s function and leaves a 240s function alone", () => {
    const chosen = pickLambdaFunction([
      { functionName: "remotion-render-4-0-471-mem2048mb-disk2048mb-240sec", timeoutInSeconds: 240 },
      { functionName: "remotion-render-4-0-471-mem2048mb-disk2048mb-480sec", timeoutInSeconds: 480 },
    ]);
    assert.equal(chosen?.functionName, "remotion-render-4-0-471-mem2048mb-disk2048mb-480sec");
    assert.equal(pickLambdaFunction([{ functionName: "old", timeoutInSeconds: 240 }]), undefined);
  });

  it("refuses to start without a serve URL", () => {
    const previous = process.env.REMOTION_LAMBDA_SERVE_URL;
    delete process.env.REMOTION_LAMBDA_SERVE_URL;
    try {
      assert.throws(() => requireLambdaServeUrl(), /REMOTION_LAMBDA_SERVE_URL/);
    } finally {
      if (previous === undefined) delete process.env.REMOTION_LAMBDA_SERVE_URL;
      else process.env.REMOTION_LAMBDA_SERVE_URL = previous;
    }
  });
});

describe("renderCaptionViaLambda", () => {
  it("passes framesPerLambda to renderMediaOnLambda under the 1000 quota", async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    const out = await renderCaptionViaLambda(request(30), "https://serve.test/index.html", {
      client: fakeClient(calls),
      readConcurrencyLimit: async () => 1000,
      download: async () => new Uint8Array([1, 2, 3]),
      pollMs: 0,
    });
    const render = calls.find((call) => call.name === "renderMediaOnLambda")!.input;
    assert.equal(render.composition, "CaptionOnClip");
    assert.equal(render.functionName, FN.functionName);
    assert.equal(render.framesPerLambda, 45);
    assert.equal(render.concurrencyPerLambda, undefined);
    assert.equal("concurrency" in render, false);
    assert.equal(out.estimatedCostUsd, 0.0126);
    assert.deepEqual([...out.bytes], [1, 2, 3]);
  });

  it("renders in one function when the quota is 10", async () => {
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    await renderCaptionViaLambda(request(2), "https://serve.test/index.html", {
      client: fakeClient(calls),
      readConcurrencyLimit: async () => 10,
      download: async () => new Uint8Array([1]),
      pollMs: 0,
    });
    const render = calls.find((call) => call.name === "renderMediaOnLambda")!.input;
    assert.equal(render.framesPerLambda, 60);
    assert.equal(render.concurrencyPerLambda, 1);
  });
});

describe("renderFrameSheetStill", () => {
  it("is one renderStillOnLambda call with no fan-out", async () => {
    const previous = process.env.REMOTION_LAMBDA_SERVE_URL;
    process.env.REMOTION_LAMBDA_SERVE_URL = "https://serve.test/index.html";
    try {
      const calls: { name: string; input: Record<string, unknown> }[] = [];
      const out = await renderFrameSheetStill({ src: "https://example.test/clip.mp4", times: [0, 1] }, { client: fakeClient(calls) });
      const stills = calls.filter((call) => call.name === "renderStillOnLambda");
      assert.equal(stills.length, 1);
      assert.equal(calls.some((call) => call.name === "renderMediaOnLambda"), false);
      assert.equal(stills[0].input.composition, "FrameSheet");
      for (const key of ["framesPerLambda", "concurrency", "concurrencyPerLambda"]) assert.equal(key in stills[0].input, false, key);
      assert.equal(out.estimatedCostUsd, 0.00018);
    } finally {
      if (previous === undefined) delete process.env.REMOTION_LAMBDA_SERVE_URL;
      else process.env.REMOTION_LAMBDA_SERVE_URL = previous;
    }
  });
});
