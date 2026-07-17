import { beforeEach, describe, expect, it, vi } from "vitest";

const { authHandler } = vi.hoisted(() => ({
  authHandler: vi.fn(async () => Response.json({ forwarded: true })),
}));

vi.mock("@/lib/auth-wired", () => ({
  auth: { handler: authHandler },
}));

import { POST } from "./route";

describe("Better Auth catch-all signup policy", () => {
  beforeEach(() => {
    authHandler.mockClear();
  });

  it("blocks the native email signup endpoint that bypasses invite policy", async () => {
    const response = await POST(
      new Request("https://app.tryepisteme.com/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "bypass@example.com",
          password: "correct-horse-battery-staple",
          name: "Bypass",
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(authHandler).not.toHaveBeenCalled();
  });

  it("also blocks a trailing-slash variant", async () => {
    const response = await POST(
      new Request("https://app.tryepisteme.com/api/auth/sign-up/email/", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(authHandler).not.toHaveBeenCalled();
  });

  it("continues forwarding anonymous sign-in and other Better Auth posts", async () => {
    const request = new Request(
      "https://app.tryepisteme.com/api/auth/sign-in/anonymous",
      { method: "POST" },
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(authHandler).toHaveBeenCalledOnce();
    expect(authHandler).toHaveBeenCalledWith(request);
  });
});
