import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();

vi.mock("@episteme/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// next/navigation `redirect` throws internally to unwind the render. We mirror
// that here so tests can assert the redirect fired *and* that control flow
// stops (nothing runs past an unverified gate).
class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}
const redirect = vi.fn((url: string): never => {
  throw new RedirectError(url);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

beforeEach(() => {
  getSession.mockReset();
  redirect.mockClear();
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
      emailVerified: false,
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
      emailVerified: false,
    });
  });

  it("surfaces emailVerified=true for a verified real user", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_real_2", emailVerified: true },
    });
    const { getCurrentSession } = await import("./session");
    expect(await getCurrentSession()).toEqual({
      userId: "user_real_2",
      isAnonymous: false,
      emailVerified: true,
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

describe("requireVerifiedSession", () => {
  it("redirects to /sign-in when there is no session", async () => {
    getSession.mockResolvedValue(null);
    const { requireVerifiedSession } = await import("./session");
    await expect(requireVerifiedSession()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects to /verify-email for an unverified real user", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_real", emailVerified: false },
    });
    const { requireVerifiedSession } = await import("./session");
    await expect(requireVerifiedSession()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/verify-email");
  });

  it("returns the session for a verified real user (no redirect)", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_verified", emailVerified: true },
    });
    const { requireVerifiedSession } = await import("./session");
    const session = await requireVerifiedSession();
    expect(session).toEqual({
      userId: "user_verified",
      isAnonymous: false,
      emailVerified: true,
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the session for an anonymous user, even if unverified", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_anon", isAnonymous: true },
    });
    const { requireVerifiedSession } = await import("./session");
    const session = await requireVerifiedSession();
    expect(session).toEqual({
      userId: "user_anon",
      isAnonymous: true,
      emailVerified: false,
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("getRequiredUserId (email-verify gate)", () => {
  it("redirects to /sign-in when no session", async () => {
    getSession.mockResolvedValue(null);
    const { getRequiredUserId } = await import("./session");
    await expect(getRequiredUserId()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects to /verify-email for an unverified real user (before any data fetch)", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_real", emailVerified: false },
    });
    const { getRequiredUserId } = await import("./session");
    await expect(getRequiredUserId()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/verify-email");
  });

  it("returns the user id for a verified real user", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_verified", emailVerified: true },
    });
    const { getRequiredUserId } = await import("./session");
    expect(await getRequiredUserId()).toBe("user_verified");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns the user id for an anonymous user (never gated)", async () => {
    getSession.mockResolvedValue({
      user: { id: "user_anon", isAnonymous: true },
    });
    const { getRequiredUserId } = await import("./session");
    expect(await getRequiredUserId()).toBe("user_anon");
    expect(redirect).not.toHaveBeenCalled();
  });
});
