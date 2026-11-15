import type { NextConfig } from "next";

import { MML_LEGACY_REDIRECTS } from "./lib/plan/mml-routes";

// The Remotion serve bundle is generated at build time into .remotion/bundle
// (see scripts/bundle-remotion.ts + the `prebuild` hook in package.json).
// Next can't statically trace `path.join(process.cwd(), ".remotion/bundle")`
// inside the renderer routes, so the bundle directory is included in their
// functions. Without it, runtime fails with
// ENOENT: /var/task/.remotion/bundle/bundle.js.map.
const IN_PROCESS_REMOTION_FILES = [
  "./.remotion/bundle/**/*",
  // Remotion's native compositor binary is dynamically required at runtime
  // (not statically importable), so Next can't trace it. Glob covers
  // every platform target; Vercel will only have the linux-x64-gnu one
  // installed post-npm-install but the wildcard is harmless.
  "./node_modules/@remotion/compositor-*/**/*",
  // The renderer itself ships sub-packages with worker entrypoints that
  // get dynamically required; include them too to be safe.
  "./node_modules/@remotion/renderer/**/*",
  // @sparticuz/chromium ships a Lambda-friendly Chromium binary + its
  // required shared libs. Force-include so the Vercel function can launch
  // Chrome (the stock Vercel Node runtime is missing libnspr4, libnss3,
  // fonts, etc.). Without this Remotion fails to launch any browser.
  "./node_modules/@sparticuz/chromium/**/*",
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler", "remotion", "undici", "ffmpeg-static"],
  async redirects() {
    return MML_LEGACY_REDIRECTS.map((rule) => ({ ...rule }));
  },
  outputFileTracingIncludes: {
    // Only the two routes that render in-process carry these. Turbopack
    // matches each key as a substring of the route's entry name
    // (".../render/route"), so "/api/admin/remotion/render" or ".../**"
    // would also match render-caption, which renders on Remotion Lambda.
    // The "/route" ending is the segment boundary that keeps it out.
    "/api/admin/remotion/render/route": IN_PROCESS_REMOTION_FILES,
    "/api/admin/remotion/render-reel/route": IN_PROCESS_REMOTION_FILES,
    // The 1080 render proxy (lib/creative-lab/render-proxy.ts) spawns the
    // ffmpeg-static binary, which no import reaches, so Next cannot trace
    // it. Only the clip imports that can meet a 4K original carry it
    // (79.8 MB unpacked on linux-x64, ffmpeg-static 5.3.0 / b6.1.1). Its
    // install script downloads that binary; npm 12 on Vercel runs it only
    // because package.json allowScripts approves ffmpeg-static@5.3.0.
    "/api/cron/creative-lab-drive-pickup": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/package.json"],
    "/api/creative-lab/artists/[id]/import-clips": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/package.json"],
    "/api/cron/creative-lab-render-tick": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffmpeg-static/package.json",
      "./node_modules/@vladmandic/face-api/dist/face-api.esm.js",
      "./node_modules/@vladmandic/face-api/model/**/*",
    ],
  },
  // render-caption renders on Remotion Lambda from REMOTION_LAMBDA_SERVE_URL
  // with @remotion/lambda/client only (lib/creative-lab/lambda.ts). It loads
  // no Chromium, compositor, renderer or serve bundle (the include keys above
  // keep those out), and it reaches render-proxy.ts only for renderAssetId,
  // which never spawns ffmpeg. The binary is traced through that module's
  // lazy import("ffmpeg-static"). Turbopack applies excludes to traced files
  // only, before it adds includes, so an exclude cannot take back an include.
  // Vercel caps a function at 250 MB uncompressed; #1186 took this one to
  // 270.41 MB, and scripts/check-function-size.mts fails CI above 230 MB.
  outputFileTracingExcludes: {
    "/api/admin/remotion/render-caption/route": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  experimental: {
    // Raise the default 1 MB body cap for Server Actions and the shared
    // body-parsing pipeline.
    serverActions: {
      bodySizeLimit: "250mb",
    },
    // Raise the proxy clone buffer from the default 10 MB so that large
    // multipart uploads are not truncated before reaching Route Handlers.
    proxyClientMaxBodySize: "250mb",
  },
  turbopack: {
    // Pin the workspace root so Next.js doesn't walk up to the parent
    // directory (which contains another package-lock.json) when this
    // project is checked out as a git worktree.
    root: __dirname,
  },
};

export default nextConfig;
