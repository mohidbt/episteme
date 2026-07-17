import { afterEach, describe, expect, it, vi } from "vitest";
import { previewGate } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("OpenRouter debug endpoint deployment gate", () => {
  it("fails closed when VERCEL_ENV is unset", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ENABLE_OR_BUCKET_DEBUG", "");
    expect(previewGate()?.status).toBe(404);
  });

  it("fails closed in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ENABLE_OR_BUCKET_DEBUG", "1");
    expect(previewGate()?.status).toBe(404);

    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(previewGate()?.status).toBe(404);
  });

  it("allows explicit preview and development environments", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(previewGate()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "development");
    expect(previewGate()).toBeNull();
  });

  it("allows the opt-in only for local non-production environments", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ENABLE_OR_BUCKET_DEBUG", "1");
    expect(previewGate()).toBeNull();

    vi.stubEnv("VERCEL_ENV", "staging");
    expect(previewGate()?.status).toBe(404);
  });
});
