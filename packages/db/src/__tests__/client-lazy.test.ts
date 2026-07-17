import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests prove DB URL resolution is deferred to first access, so that
// `next build` (which imports route modules under NODE_ENV=production) does
// not crash at import time when APP_RUNTIME_DATABASE_URL is unset. The
// fail-closed guard must still fire on first real DB access.

const savedEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("@episteme/db client (lazy resolution)", () => {
  it("does NOT resolve the DB URL at import under production with no APP_RUNTIME_DATABASE_URL", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_RUNTIME_DATABASE_URL;
    delete process.env.DATABASE_URL;

    // Importing the client module must not throw — resolution is deferred.
    await expect(import("../client")).resolves.toBeDefined();
  });

  it("throws (fail-closed) on FIRST real DB access under production with no APP_RUNTIME_DATABASE_URL", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_RUNTIME_DATABASE_URL;
    delete process.env.DATABASE_URL;

    const { db } = await import("../client");

    // No access yet -> no throw above. First access to a query-builder
    // method must trigger resolution and hit the fail-closed guard.
    expect(() => db.select()).toThrow(
      /APP_RUNTIME_DATABASE_URL is required in production/,
    );
  });
});
