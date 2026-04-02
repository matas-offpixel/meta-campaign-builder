import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
