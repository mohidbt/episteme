import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the email sender so we don't hit the network.
vi.mock("./send-email", () => ({ sendEmail: vi.fn() }));

import { sendVerificationEmailCallback } from "./verification-callback";
import { sendEmail } from "./send-email";

const mockedSend = vi.mocked(sendEmail);

describe("sendVerificationEmailCallback", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends to the user email with the verify url (callbackURL appended)", async () => {
    mockedSend.mockResolvedValue(true);

    await sendVerificationEmailCallback({
      user: { id: "u1", email: "ada@example.com", name: "Ada" },
      url: "https://app.test/api/auth/verify-email?token=tok",
      token: "tok",
    });

    expect(mockedSend).toHaveBeenCalledOnce();
    const arg = mockedSend.mock.calls[0][0];
    expect(arg.to).toBe("ada@example.com");
    expect(arg.subject.toLowerCase()).toContain("verify");
    // original token preserved, callbackURL added pointing at our landing page
    expect(arg.text).toContain("token=tok");
    expect(arg.text).toContain(encodeURIComponent("/verify-email"));
  });

  it("does NOT throw when the send rejects (non-fatal to signup)", async () => {
    mockedSend.mockRejectedValue(new Error("resend exploded"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendVerificationEmailCallback({
        user: { id: "u1", email: "ada@example.com" },
        url: "https://app.test/api/auth/verify-email?token=tok",
        token: "tok",
      }),
    ).resolves.toBeUndefined();
  });
});
