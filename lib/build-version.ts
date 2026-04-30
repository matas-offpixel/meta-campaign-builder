export function getCurrentBuildVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || "dev";
}
