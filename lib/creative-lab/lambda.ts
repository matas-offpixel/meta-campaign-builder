/**
 * Caption renders on Remotion Lambda. @remotion/lambda 4.0.471 has
 * renderMediaOnLambda and getRenderProgress, not renderMediaOnLambdaAndStream.
 * deploySiteFromBundle is also absent: the deploy script calls bundle(),
 * then deploySite(), which bundles the entry point again.
 *
 * A new AWS account's Lambda concurrency quota is often 10. One render
 * fans out to a function per chunk, so a quota of 10 (or lower) renders
 * the whole clip in one function.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GetServiceQuotaCommand } from "@aws-sdk/client-service-quotas";
import { LambdaClientInternals } from "@remotion/lambda/client";

import type { CaptionRenderRequest } from "./render.ts";

export const REMOTION_REGION = "eu-west-2" as const;
export const LAMBDA_TIMEOUT_SECONDS = 240;
export const LAMBDA_MEMORY_MB = 2048;
export const LAMBDA_DISK_MB = 2048;
export const LAMBDA_SITE_NAME = "creative-lab";

/** Same code remotion lambda quotas reads (LAMBDA_CONCURRENCY_LIMIT_QUOTA). */
const CONCURRENCY_QUOTA_CODE = "L-B99A9384";

export type LambdaChunking = { framesPerLambda?: number; concurrencyPerLambda?: number; singleFunction: boolean };

/** One function when the account cannot fan out. Remotion's own default otherwise. */
export function lambdaChunking(concurrencyLimit: number, frameCount: number): LambdaChunking {
  if (concurrencyLimit <= 10) {
    return { framesPerLambda: Math.max(1, frameCount), concurrencyPerLambda: 1, singleFunction: true };
  }
  return { singleFunction: false };
}

export function frameCount(props: CaptionRenderRequest["props"]): number {
  const fps = props.fps || 30;
  const inS = props.inS ?? 0;
  const outS = props.outS ?? props.durationInSeconds;
  return Math.max(1, Math.round((outS - inS) * fps));
}

export function requireLambdaServeUrl(override?: string): string {
  const url = (override ?? process.env.REMOTION_LAMBDA_SERVE_URL ?? "").trim();
  if (!url) {
    throw new Error("REMOTION_LAMBDA_SERVE_URL is not set. Run scripts/remotion-lambda-deploy.mts and set the printed serve URL.");
  }
  return url;
}

export async function readConcurrencyLimit(): Promise<number> {
  const client = LambdaClientInternals.getServiceQuotasClient(REMOTION_REGION, null);
  const quota = await client.send(new GetServiceQuotaCommand({ ServiceCode: "lambda", QuotaCode: CONCURRENCY_QUOTA_CODE }));
  const value = quota.Quota?.Value;
  if (value == null) throw new Error("Lambda concurrency quota did not come back");
  return value;
}

export type LambdaRenderOutput = {
  bytes: Uint8Array;
  renderMs: number;
  estimatedCostUsd: number | null;
  estimatedCostDisplay: string | null;
  bucketName: string;
  lambdaRenderId: string;
};

type Started = { bucketName: string; renderId: string };

/** Render, poll once through to the end, and download the mp4. Deletes a partial S3 render if the poll fails. */
export async function renderCaptionViaLambda(req: CaptionRenderRequest, serveUrl: string): Promise<LambdaRenderOutput> {
  const { getFunctions, renderMediaOnLambda, getRenderProgress, downloadMedia, deleteRender } = await import("@remotion/lambda");
  const functions = await getFunctions({ region: REMOTION_REGION, compatibleOnly: true });
  const functionName = functions[0]?.functionName;
  if (!functionName) throw new Error("No compatible Remotion Lambda function in eu-west-2. Run scripts/remotion-lambda-deploy.mts.");

  const limit = await readConcurrencyLimit();
  const chunking = lambdaChunking(limit, frameCount(req.props));
  const startedAt = Date.now();
  let started: Started | null = null;
  try {
    const output = await renderMediaOnLambda({
      region: REMOTION_REGION,
      functionName,
      serveUrl,
      composition: "CaptionOnClip",
      inputProps: req.props as unknown as Record<string, unknown>,
      codec: "h264",
      privacy: "private",
      imageFormat: "jpeg",
      maxRetries: 1,
      muted: req.muted,
      framesPerLambda: chunking.framesPerLambda,
      concurrencyPerLambda: chunking.concurrencyPerLambda,
    });
    started = { bucketName: output.bucketName, renderId: output.renderId };

    const deadline = startedAt + 270_000;
    let progress = await getRenderProgress({ region: REMOTION_REGION, functionName, bucketName: output.bucketName, renderId: output.renderId });
    while (!progress.done && !progress.fatalErrorEncountered) {
      if (Date.now() > deadline) throw new Error("Lambda render timed out");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      progress = await getRenderProgress({ region: REMOTION_REGION, functionName, bucketName: output.bucketName, renderId: output.renderId });
    }
    if (progress.fatalErrorEncountered || !progress.done) {
      throw new Error(progress.errors[0]?.message ?? "Lambda render failed");
    }

    const temp = path.join(os.tmpdir(), `caption-${output.renderId}.mp4`);
    try {
      await downloadMedia({ region: REMOTION_REGION, bucketName: output.bucketName, renderId: output.renderId, outPath: temp });
      const bytes = new Uint8Array(await fs.readFile(temp));
      return {
        bytes,
        renderMs: Date.now() - startedAt,
        estimatedCostUsd: progress.costs.accruedSoFar,
        estimatedCostDisplay: progress.costs.displayCost,
        bucketName: output.bucketName,
        lambdaRenderId: output.renderId,
      };
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  } catch (err) {
    if (started) {
      await deleteRender({ region: REMOTION_REGION, bucketName: started.bucketName, renderId: started.renderId }).catch(() => {});
    }
    throw err;
  }
}

export async function deleteLambdaRender(target: { bucketName: string; lambdaRenderId: string }): Promise<void> {
  const { deleteRender } = await import("@remotion/lambda");
  await deleteRender({ region: REMOTION_REGION, bucketName: target.bucketName, renderId: target.lambdaRenderId });
}
