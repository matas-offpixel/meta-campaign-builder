/**
 * Caption renders on Remotion Lambda. @remotion/lambda 4.0.471 has
 * renderMediaOnLambda and getRenderProgress, not renderMediaOnLambdaAndStream.
 * deploySiteFromBundle is also absent: the deploy script calls bundle(),
 * then deploySite(), which bundles the entry point again.
 *
 * The Vercel route imports @remotion/lambda/client. The package root
 * loads @remotion/bundler, and that native rspack binding is not in
 * the function. The mp4 is read with the S3 client from the progress
 * outKey, so this path does not load @remotion/renderer either.
 *
 * A new AWS account's Lambda concurrency quota is often 10. One render
 * fans out to a function per chunk, so a quota of 10 (or lower) renders
 * the whole clip in one function.
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { GetServiceQuotaCommand } from "@aws-sdk/client-service-quotas";
import { LambdaClientInternals } from "@remotion/lambda/client";

import type { CaptionRenderRequest } from "./render.ts";

export const REMOTION_REGION = "eu-west-2" as const;
export const LAMBDA_TIMEOUT_SECONDS = 480;

/** The function whose timeout is the one this build deploys. A shorter function is not used. */
export function pickLambdaFunction<T extends { functionName: string; timeoutInSeconds: number }>(
  functions: readonly T[],
  timeoutSeconds = LAMBDA_TIMEOUT_SECONDS,
): T | undefined {
  return functions.find((fn) => fn.timeoutInSeconds === timeoutSeconds);
}
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

async function downloadLambdaObject(bucket: string, key: string): Promise<Uint8Array> {
  const client = LambdaClientInternals.getS3Client({
    region: REMOTION_REGION,
    customCredentials: null,
    forcePathStyle: false,
    requestHandler: null,
  });
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!object.Body) throw new Error("Lambda render produced no file");
  return new Uint8Array(await object.Body.transformToByteArray());
}

/** Render, poll once through to the end, and download the mp4. Deletes a partial S3 render if the poll fails. */
export async function renderCaptionViaLambda(req: CaptionRenderRequest, serveUrl: string): Promise<LambdaRenderOutput> {
  const { getFunctions, renderMediaOnLambda, getRenderProgress, deleteRender } = await import("@remotion/lambda/client");
  const functions = await getFunctions({ region: REMOTION_REGION, compatibleOnly: true });
  const functionName = pickLambdaFunction(functions)?.functionName;
  if (!functionName) throw new Error("No 480s Remotion Lambda function in eu-west-2. Run scripts/remotion-lambda-deploy.mts.");

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

    const deadline = startedAt + 450_000;
    let progress = await getRenderProgress({ region: REMOTION_REGION, functionName, bucketName: output.bucketName, renderId: output.renderId });
    while (!progress.done && !progress.fatalErrorEncountered) {
      if (Date.now() > deadline) throw new Error("Lambda render timed out");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      progress = await getRenderProgress({ region: REMOTION_REGION, functionName, bucketName: output.bucketName, renderId: output.renderId });
    }
    if (progress.fatalErrorEncountered || !progress.done) {
      throw new Error(progress.errors[0]?.message ?? "Lambda render failed");
    }

    if (!progress.outBucket || !progress.outKey) throw new Error("Lambda render finished without an output file");
    const bytes = await downloadLambdaObject(progress.outBucket, progress.outKey);
    return {
      bytes,
      renderMs: Date.now() - startedAt,
      estimatedCostUsd: progress.costs.accruedSoFar,
      estimatedCostDisplay: progress.costs.displayCost,
      bucketName: output.bucketName,
      lambdaRenderId: output.renderId,
    };
  } catch (err) {
    if (started) {
      await deleteRender({ region: REMOTION_REGION, bucketName: started.bucketName, renderId: started.renderId }).catch(() => {});
    }
    throw err;
  }
}

export async function deleteLambdaRender(target: { bucketName: string; lambdaRenderId: string }): Promise<void> {
  const { deleteRender } = await import("@remotion/lambda/client");
  await deleteRender({ region: REMOTION_REGION, bucketName: target.bucketName, renderId: target.lambdaRenderId });
}
