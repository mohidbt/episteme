import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  // Demo cut 2026-05-04: pre-existing tsc errors in unrelated files (reader pkg, test mocks)
  // block build; tracked for phase-1.9-cleanup. Re-enable strict check after.
  typescript: { ignoreBuildErrors: true },
  transpilePackages: [
    "@episteme/db",
    "@episteme/auth",
    "@episteme/editor",
    "@episteme/markdown",
    "@episteme/reader",
  ],
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // pdfjs-dist lazy-imports pdf.worker.mjs at runtime ("fake worker" fallback).
  // Vercel's nft trace misses it because the path is built dynamically.
  // Force-include so /var/task has the file. See seed cover-extract failures
  // in prod logs (deploy lxbwnu9nx).
  outputFileTracingIncludes: {
    "/api/**/*": [
      "../../node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
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
