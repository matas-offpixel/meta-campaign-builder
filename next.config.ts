import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler", "remotion"],
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
    ],
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
