import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@episteme/db",
    "@episteme/auth",
    "@episteme/editor",
    "@episteme/markdown",
  ],
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // Pin turbopack to apps/km so worktree dev servers don't CPU-peg hunting
  // for a project root across the outer monorepo. See memory
  // project_turbopack_worktree_crash.
  turbopack: { root: path.resolve(__dirname) },
};

export default config;
