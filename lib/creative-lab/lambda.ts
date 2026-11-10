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
 * One render fans out to a function per chunk. A quota of 10 or lower
 * (a new AWS account's default) renders the whole clip in one function.
 * eu-west-2 has 1000 since 10 Nov 2026: a caption render then uses at
 * most MAX_FUNCTIONS_PER_CAPTION_RENDER functions, and the render tick
 * starts at most MAX_LAB_RENDERS_AT_ONCE renders. A still is always one
 * function. Measurements are in docs/REMOTION_LAMBDA_SETUP.md.
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

/**
 * 20 functions rendered a 26 s clip in 30 s for $0.0126. Remotion's
 * default put it on 33 (24 s, $0.0150); 11 took 52 s for $0.0117.
 */
export const MAX_FUNCTIONS_PER_CAPTION_RENDER = 20;

/** Remotion's own floor (bestFramesPerFunctionParam), so a 2 s clip stays on 3 functions. */
export const MIN_FRAMES_PER_LAMBDA = 20;

/**
 * 4 renders x (20 + 1 orchestrator) = 84 functions, 8% of the quota. A
 * default 8-ad round renders in two ticks instead of eight.
 */
export const MAX_LAB_RENDERS_AT_ONCE = 4;

/** One function when the account cannot fan out. Otherwise at most MAX_FUNCTIONS_PER_CAPTION_RENDER chunks of at least MIN_FRAMES_PER_LAMBDA frames. */
export function lambdaChunking(concurrencyLimit: number, frameCount: number): LambdaChunking {
  const frames = Math.max(1, frameCount);
  if (concurrencyLimit <= 10) {
    return { framesPerLambda: frames, concurrencyPerLambda: 1, singleFunction: true };
  }
  const framesPerLambda = Math.max(MIN_FRAMES_PER_LAMBDA, Math.ceil(frames / MAX_FUNCTIONS_PER_CAPTION_RENDER));
  return { framesPerLambda, singleFunction: false };
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

type LambdaClientModule = typeof import("@remotion/lambda/client");

/** Test seams. Production loads @remotion/lambda/client, reads the quota and downloads from S3. */
export type LambdaDeps = {
  client?: Pick<LambdaClientModule, "getFunctions" | "renderMediaOnLambda" | "getRenderProgress" | "deleteRender" | "renderStillOnLambda">;
  readConcurrencyLimit?: () => Promise<number>;
  download?: (bucket: string, key: string) => Promise<Uint8Array>;
  pollMs?: number;
};

async function lambdaClient(deps?: LambdaDeps): Promise<NonNullable<LambdaDeps["client"]>> {
  return deps?.client ?? (await import("@remotion/lambda/client"));
}

/** Render, poll once through to the end, and download the mp4. Deletes a partial S3 render if the poll fails. */
export async function renderCaptionViaLambda(req: CaptionRenderRequest, serveUrl: string, deps?: LambdaDeps): Promise<LambdaRenderOutput> {
  const { getFunctions, renderMediaOnLambda, getRenderProgress, deleteRender } = await lambdaClient(deps);
  const functions = await getFunctions({ region: REMOTION_REGION, compatibleOnly: true });
  const functionName = pickLambdaFunction(functions)?.functionName;
  if (!functionName) throw new Error("No 480s Remotion Lambda function in eu-west-2. Run scripts/remotion-lambda-deploy.mts.");

  const limit = await (deps?.readConcurrencyLimit ?? readConcurrencyLimit)();
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
      await new Promise((resolve) => setTimeout(resolve, deps?.pollMs ?? 1000));
      progress = await getRenderProgress({ region: REMOTION_REGION, functionName, bucketName: output.bucketName, renderId: output.renderId });
    }
    if (progress.fatalErrorEncountered || !progress.done) {
      throw new Error(progress.errors[0]?.message ?? "Lambda render failed");
    }

    if (!progress.outBucket || !progress.outKey) throw new Error("Lambda render finished without an output file");
    const bytes = await (deps?.download ?? downloadLambdaObject)(progress.outBucket, progress.outKey);
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

/**
 * One still of eight frames. A still is a single Lambda invocation
 * (2048 MB, eu-west-2), not the video fan-out, whatever the quota.
 * estimatedPrice is the call's own cost.
 */
export async function renderFrameSheetStill(
  input: { src: string; times: number[] },
  deps?: Pick<LambdaDeps, "client">,
): Promise<{ url: string; estimatedCostUsd: number | null }> {
  const { getFunctions, renderStillOnLambda } = await lambdaClient(deps);
  const functions = await getFunctions({ region: REMOTION_REGION, compatibleOnly: true });
  const fn = pickLambdaFunction(functions);
  if (!fn) throw new Error("No caption Lambda function is deployed.");
  const output = await renderStillOnLambda({
    region: REMOTION_REGION,
    functionName: fn.functionName,
    serveUrl: requireLambdaServeUrl(),
    composition: "FrameSheet",
    inputProps: { src: input.src, times: input.times, fps: 30 },
    imageFormat: "jpeg",
    privacy: "public",
    frame: 0,
  });
  const price = output.estimatedPrice as { accruedSoFar?: number } | undefined;
  return { url: output.url, estimatedCostUsd: price?.accruedSoFar ?? null };
}

export async function deleteLambdaRender(target: { bucketName: string; lambdaRenderId: string }): Promise<void> {
  const { deleteRender } = await import("@remotion/lambda/client");
  await deleteRender({ region: REMOTION_REGION, bucketName: target.bucketName, renderId: target.lambdaRenderId });
}
