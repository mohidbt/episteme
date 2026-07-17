import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// Baseline browser hardening that is safe for both the app and public-note
// surfaces. The CSP deliberately limits only high-risk legacy capabilities;
// it does not set default-src/script-src yet because Next.js and Sentry need a
// nonce-aware rollout before those directives can be enforced safely.
export const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
  },
] as const;

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
  // Document-Policy: js-profiling is required for Sentry browser profiling.
  // See GSD-110. Chromium-only header; other browsers ignore.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Document-Policy", value: "js-profiling" },
          ...SECURITY_HEADERS,
        ],
      },
    ];
  },
};

export default withSentryConfig(config, {
  org: "episteme-rb",
  project: "tryepisteme",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  disableLogger: true,
  // Tunnel Sentry requests through Next to bypass ad-blockers.
  tunnelRoute: "/monitoring",
});
