import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@episteme/db", "@episteme/auth"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
    resolveAlias: {
      canvas: { browser: "./empty-module.js" },
    },
  },
};

export default nextConfig;
