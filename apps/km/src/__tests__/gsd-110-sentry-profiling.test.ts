// GSD-110: lock Sentry profiling configuration against regression.
// Asserts source files contain the expected profiling integration
// and Document-Policy header. Any edit that breaks profiling
// must update both the source and these assertions.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(appRoot, rel), "utf8");
}

describe("GSD-110: Node profiling on server", () => {
  const src = read("sentry.server.config.ts");

  it("imports nodeProfilingIntegration from @sentry/profiling-node", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*nodeProfilingIntegration[^}]*\}\s*from\s*["']@sentry\/profiling-node["']/,
    );
  });

  it("registers nodeProfilingIntegration in integrations array", () => {
    expect(src).toMatch(/integrations\s*:\s*\[[^\]]*nodeProfilingIntegration\(\)[^\]]*\]/s);
  });

  it("sets profileSessionSampleRate", () => {
    expect(src).toMatch(/profileSessionSampleRate\s*:/);
  });

  it("sets profileLifecycle to 'trace'", () => {
    expect(src).toMatch(/profileLifecycle\s*:\s*["']trace["']/);
  });
});

describe("GSD-110: Browser profiling on client", () => {
  const src = read("instrumentation-client.ts");

  it("registers browserProfilingIntegration in integrations array", () => {
    expect(src).toMatch(
      /integrations\s*:\s*\[[\s\S]*Sentry\.browserProfilingIntegration\(\)[\s\S]*\]/,
    );
  });

  it("sets profileSessionSampleRate", () => {
    expect(src).toMatch(/profileSessionSampleRate\s*:/);
  });
});

describe("GSD-110: Document-Policy header for browser profiling", () => {
  const src = read("next.config.ts");

  it("defines headers() with js-profiling Document-Policy", () => {
    expect(src).toMatch(/headers\s*\(\s*\)\s*\{/);
    expect(src).toContain("Document-Policy");
    expect(src).toContain("js-profiling");
  });

  it("applies header to all paths", () => {
    expect(src).toMatch(/source\s*:\s*["']\/:path\*["']/);
  });
});
