import type { NextConfig } from "next";

const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite"],
  env: {
    APP_BUILD_ID: commit ? commit.slice(0, 7) : "dev",
    APP_BUILT_AT: new Date().toISOString(),
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }],
  },
};

export default nextConfig;
