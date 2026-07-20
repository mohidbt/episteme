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
    mockedSend.mockResolvedValue({ ok: true, id: "re_msg_1" });

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

  it("logs success WITH the Resend id so a delivered send is traceable", async () => {
    mockedSend.mockResolvedValue({ ok: true, id: "re_msg_42" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendVerificationEmailCallback({
      user: { id: "u1", email: "ada@example.com" },
      url: "https://app.test/api/auth/verify-email?token=tok",
      token: "tok",
    });

    expect(info).toHaveBeenCalled();
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("re_msg_42");
  });

  it("loudly console.errors when the send is suppressed (missing Resend key)", async () => {
    mockedSend.mockResolvedValue({ ok: false, reason: "unset" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendVerificationEmailCallback({
      user: { id: "u1", email: "ada@example.com" },
      url: "https://app.test/api/auth/verify-email?token=tok",
      token: "tok",
    });

    expect(err).toHaveBeenCalled();
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("unset");
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
