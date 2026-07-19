// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const sendVerificationEmail = vi.fn();
vi.mock("@episteme/auth/client", () => ({
  authClient: {
    sendVerificationEmail: (...a: unknown[]) => sendVerificationEmail(...a),
  },
}));

import { VerifyEmailClient } from "./VerifyEmailClient";

describe("VerifyEmailClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the success state when verified", () => {
    render(<VerifyEmailClient error={null} verified email="ada@example.com" />);
    expect(screen.getByText(/verified/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
  });

  it("Continue navigates home on success", () => {
    render(<VerifyEmailClient error={null} verified email={null} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("shows the PENDING state (not 'verified') for an unverified real user", () => {
    render(
      <VerifyEmailClient error={null} verified={false} email="ada@example.com" />,
    );
    // must NOT claim the email is verified
    expect(screen.queryByText(/your email address is confirmed/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    // shows the pending copy with the user's email + a resend action
    expect(screen.getByText(/verify your email/i)).toBeTruthy();
    expect(screen.getByText(/ada@example\.com/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /resend/i })).toBeTruthy();
  });

  it("pending resends to the session email without retyping", () => {
    sendVerificationEmail.mockResolvedValue({});
    render(
      <VerifyEmailClient error={null} verified={false} email="ada@example.com" />,
    );
    // no email input rendered when the email is known
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        callbackURL: "/verify-email",
      }),
    );
  });

  it("shows the expired-link resend form when error param is present", () => {
    render(<VerifyEmailClient error="invalid_token" verified={false} email={null} />);
    expect(screen.getByText(/expired|invalid/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /resend/i })).toBeTruthy();
    // unknown email → asks for one
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });

  it("resend calls authClient.sendVerificationEmail with the typed email", () => {
    sendVerificationEmail.mockResolvedValue({});
    render(<VerifyEmailClient error="invalid_token" verified={false} email={null} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        callbackURL: "/verify-email",
      }),
    );
  });

  it("shows an error message when resend rejects", async () => {
    sendVerificationEmail.mockRejectedValue(new Error("boom"));
    render(<VerifyEmailClient error="invalid_token" verified={false} email={null} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    await waitFor(() => {
      expect(screen.getByText(/couldn.t send/i)).toBeTruthy();
    });
  });

  it("shows a sent confirmation when resend succeeds", async () => {
    sendVerificationEmail.mockResolvedValue({ error: null });
    render(<VerifyEmailClient error="invalid_token" verified={false} email={null} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    await waitFor(() => {
      expect(screen.getByText(/check your inbox/i)).toBeTruthy();
    });
  });
});
