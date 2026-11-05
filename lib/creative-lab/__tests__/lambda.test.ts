import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lambdaChunking, requireLambdaServeUrl } from "../lambda.ts";

describe("lambda chunking", () => {
  it("renders in one function when the concurrency quota is 10 or lower", () => {
    assert.deepEqual(lambdaChunking(10, 591), { framesPerLambda: 591, concurrencyPerLambda: 1, singleFunction: true });
    assert.equal(lambdaChunking(8, 30).singleFunction, true);
  });

  it("leaves the split to Remotion when the quota is higher", () => {
    assert.deepEqual(lambdaChunking(1000, 591), { singleFunction: false });
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
