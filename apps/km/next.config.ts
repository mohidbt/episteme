import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@episteme/db",
    "@episteme/auth",
    "@episteme/editor",
    "@episteme/markdown",
  ],
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  experimental: {
    optimizePackageImports: ["lucide-react", "@base-ui/react"],
  },
  // Pin turbopack root to the worktree root (2 levels up from apps/km) so
  // Turbopack can resolve next/package.json through pnpm's symlinks.
  // apps/km alone fails because Turbopack can't follow ../../../node_modules.
  // See memory project_turbopack_worktree_crash.
  turbopack: { root: path.resolve(here, "..", "..") },
};

export default config;
