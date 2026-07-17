import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests prove that resolving the S3 storage config is deferred to first
// access (not module load), so that `next build` — which imports every route
// module under NODE_ENV=production to collect page data — does not crash at
// import time when the required S3_* env vars are unset. The fail-closed guard
// in resolveStorageConfig() must still fire on first real storage access.

function unsetS3Prod() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("S3_ENDPOINT", undefined);
  vi.stubEnv("S3_BUCKET", undefined);
  vi.stubEnv("S3_ACCESS_KEY", undefined);
  vi.stubEnv("S3_SECRET_KEY", undefined);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("@/lib/storage (lazy resolution)", () => {
  it("does NOT resolve the storage config at import under production with S3_* unset", async () => {
    unsetS3Prod();

    // Importing the storage module must not throw — resolution is deferred.
    await expect(import("./storage")).resolves.toBeDefined();
  });

  it("throws (fail-closed) on FIRST access to storageConfig under production with S3_* unset", async () => {
    unsetS3Prod();

    const { storageConfig } = await import("./storage");

    // No property read yet -> no throw above. First property access must
    // trigger resolution and hit the fail-closed guard.
    expect(() => storageConfig.endpoint).toThrow(
      /S3_ENDPOINT is required in production/,
    );
  });

  it("throws (fail-closed) on FIRST access to a storage method under production with S3_* unset", async () => {
    unsetS3Prod();

    const { storage } = await import("./storage");

    // Constructing the underlying S3 client (which resolves the config) is
    // deferred to first method access — so reaching for a storage method
    // under prod with S3_* unset hits the fail-closed guard.
    expect(() => storage.objectExists("any-key")).toThrow(
      /S3_ENDPOINT is required in production/,
    );
  });
});
