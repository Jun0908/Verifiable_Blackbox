import type {NextConfig} from "next";
import {fileURLToPath} from "node:url";

const nextConfig: NextConfig = {
  distDir: process.env.DEMO_NEXT_DIST_DIR || ".next",
  turbopack: {root: fileURLToPath(new URL("../..", import.meta.url))},
  allowedDevOrigins: ["127.0.0.1"],
  typedRoutes: true,
};

export default nextConfig;
