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
    "/api/admin/remotion/**": ["./.remotion/bundle/**/*"],
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
