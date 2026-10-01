import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://localhost:4000";
    return [{ source: "/backend/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
