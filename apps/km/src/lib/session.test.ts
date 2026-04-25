import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

beforeEach(() => {
  getSession.mockReset();
  vi.resetModules();
});

describe("getCurrentSession", () => {
  it("returns null when no session", async () => {
    getSession.mockResolvedValue(null);
    const { getCurrentSession } = await import("./session");
    expect(await getCurrentSession()).toBeNull();
  });

  it("returns userId + isAnonymous=true for anon user", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_anon_1", isAnonymous: true },
    });
    const { getCurrentSession } = await import("./session");
    expect(await getCurrentSession()).toEqual({
      userId: "user_anon_1",
      isAnonymous: true,
    });
  });

  it("returns userId + isAnonymous=false for normal user", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_real_1" },
    });
    const { getCurrentSession } = await import("./session");
    expect(await getCurrentSession()).toEqual({
      userId: "user_real_1",
      isAnonymous: false,
    });
  });
});

describe("getCurrentUserId", () => {
  it("returns null when no session", async () => {
    getSession.mockResolvedValue(null);
    const { getCurrentUserId } = await import("./session");
    expect(await getCurrentUserId()).toBeNull();
  });

  it("returns the user id when session exists", async () => {
    getSession.mockResolvedValue({ user: { id: "user_x" } });
    const { getCurrentUserId } = await import("./session");
    expect(await getCurrentUserId()).toBe("user_x");
  });
});
