/**
 * Deploy the Creative Lab Remotion site and function. Run by hand when
 * the composition changes. Not a build step.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/remotion-lambda-deploy.mts
 *
 * Prints the bucket, function name, serve URL and concurrency quota.
 * @remotion/lambda 4.0.471 has no deploySiteFromBundle, so this bundles
 * the entry point and then calls deploySite, which bundles it again.
 * bundle() does not read remotion.config.ts, so the webpack override is
 * passed in. That override inlines the caption font.
 */

import path from "node:path";

import { bundle } from "@remotion/bundler";
import { ConfigInternals } from "@remotion/cli/config";
import { deployFunction, deploySite, getFunctions, getOrCreateBucket } from "@remotion/lambda";

import "../remotion.config.ts";

import { LAMBDA_DISK_MB, LAMBDA_MEMORY_MB, LAMBDA_SITE_NAME, LAMBDA_TIMEOUT_SECONDS, REMOTION_REGION, lambdaChunking, readConcurrencyLimit } from "../lib/creative-lab/lambda.ts";

const regionOnFile = process.env.REMOTION_AWS_REGION?.trim();
if (regionOnFile && regionOnFile !== REMOTION_REGION) {
  throw new Error("REMOTION_AWS_REGION is not eu-west-2");
}

const { bucketName } = await getOrCreateBucket({ region: REMOTION_REGION });
console.log(`bucket ${bucketName}`);

const existing = await getFunctions({ region: REMOTION_REGION, compatibleOnly: true });
const compatible = existing.find((fn) => fn.memorySizeInMb === LAMBDA_MEMORY_MB && fn.timeoutInSeconds === LAMBDA_TIMEOUT_SECONDS && fn.diskSizeInMb === LAMBDA_DISK_MB);
const chosen = compatible ?? existing[0];
let functionName: string;
if (chosen) {
  functionName = chosen.functionName;
  console.log(`function ${functionName} (already deployed)`);
} else {
  const deployed = await deployFunction({
    region: REMOTION_REGION,
    timeoutInSeconds: LAMBDA_TIMEOUT_SECONDS,
    memorySizeInMb: LAMBDA_MEMORY_MB,
    diskSizeInMb: LAMBDA_DISK_MB,
    createCloudWatchLogGroup: true,
  });
  functionName = deployed.functionName;
  console.log(`function ${functionName}`);
}

const entryPoint = path.join(process.cwd(), "src/remotion/index.tsx");
const webpackOverride = ConfigInternals.getWebpackOverrideFn();
const localBundle = await bundle({ entryPoint, webpackOverride });
console.log(`local bundle ${localBundle}`);

const site = await deploySite({
  entryPoint,
  bucketName,
  region: REMOTION_REGION,
  siteName: LAMBDA_SITE_NAME,
  options: { webpackOverride, enableCaching: false },
});
console.log(`serveUrl ${site.serveUrl}`);
console.log(`site ${site.siteName}`);
console.log(`uploaded ${site.stats.uploadedFiles} deleted ${site.stats.deletedFiles} untouched ${site.stats.untouchedFiles}`);

const concurrency = await readConcurrencyLimit();
const chunking = lambdaChunking(concurrency, 1);
console.log(`concurrency ${concurrency}`);
if (chunking.singleFunction) {
  console.log("quota is 10 or lower: caption renders use one Lambda function");
}
