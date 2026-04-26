// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * Regression lock: the note page RSC must never be cached by Next.js.
 *
 * The server component mints a Hocuspocus JWT (10-min TTL) at render time.
 * If Next.js caches the RSC payload longer than 10 minutes the client receives
 * a stale, expired token and collab connections fail silently.
 *
 * `export const dynamic = "force-dynamic"` is the contract.  This test is the
 * regression lock — if someone removes it the test will catch the regression
 * before it ships.
 */

// Stub all heavy server-side imports so we can load page.tsx without a real
// DB/auth/Next.js server context.  We only care about the `dynamic` constant.

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@episteme/db/schema", () => ({
  noteLinks: {},
  notes: {},
  user: {},
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@/lib/default-library", () => ({ getDefaultLibrary: vi.fn() }));
vi.mock("@/components/PathPill", () => ({ PathPill: vi.fn(() => null) }));
vi.mock("@/lib/tree", () => ({ splitFolderPath: vi.fn(() => []) }));
vi.mock("@/components/BacklinksPanel", () => ({
  BacklinksPanel: vi.fn(() => null),
}));
vi.mock("./NotePageClient", () => ({ NotePageClient: vi.fn(() => null) }));
vi.mock("@/lib/collab-token", () => ({ mintCollabToken: vi.fn(async () => "test-token") }));
vi.mock("@/lib/flags", () => ({
  COLLAB_ENABLED: false,
  COLLAB_URL: "ws://localhost:1234",
}));

describe("note page route config", () => {
  it("is marked dynamic so SSR token isn't cached past TTL", async () => {
    const pageModule = await import("./page");
    expect((pageModule as Record<string, unknown>).dynamic).toBe(
      "force-dynamic",
    );
  });
});
