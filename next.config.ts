import type { NextConfig } from "next";

import { MML_LEGACY_REDIRECTS } from "./lib/plan/mml-routes";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler", "remotion", "undici", "ffmpeg-static"],
  async redirects() {
    return MML_LEGACY_REDIRECTS.map((rule) => ({ ...rule }));
  },
  // The Remotion serve bundle is generated at build time into .remotion/bundle
  // (see scripts/bundle-remotion.ts + the `prebuild` hook in package.json).
  // Next can't statically trace `path.join(process.cwd(), ".remotion/bundle")`
  // inside the renderer route, so we explicitly include the bundle directory
  // in the route's Lambda. Without this, runtime fails with
  // ENOENT: /var/task/.remotion/bundle/bundle.js.map.
  outputFileTracingIncludes: {
    "/api/admin/remotion/**": [
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
    ],
    // The 1080 render proxy (lib/creative-lab/render-proxy.ts) spawns the
    // ffmpeg-static binary, which no import reaches, so Next cannot trace
    // it. Only the clip imports that can meet a 4K original carry it
    // (79.8 MB unpacked on linux-x64, ffmpeg-static 5.3.0 / b6.1.1).
    "/api/cron/creative-lab-drive-pickup": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/package.json"],
    "/api/creative-lab/artists/[id]/import-clips": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffmpeg-static/package.json"],
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
