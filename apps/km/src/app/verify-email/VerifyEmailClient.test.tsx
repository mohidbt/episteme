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
  authClient: { sendVerificationEmail: (...a: unknown[]) => sendVerificationEmail(...a) },
}));

import { VerifyEmailClient } from "./VerifyEmailClient";

describe("VerifyEmailClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the success state when there is no error param", () => {
    render(<VerifyEmailClient error={null} />);
    expect(screen.getByText(/verified/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
    // no resend UI on success
    expect(screen.queryByRole("button", { name: /resend/i })).toBeNull();
  });

  it("Continue navigates home on success", () => {
    render(<VerifyEmailClient error={null} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("shows the error state with a resend form when error param is present", () => {
    render(<VerifyEmailClient error="invalid_token" />);
    expect(screen.getByText(/expired|invalid/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /resend/i })).toBeTruthy();
  });

  it("resend calls authClient.sendVerificationEmail with the typed email", async () => {
    sendVerificationEmail.mockResolvedValue({});
    render(<VerifyEmailClient error="invalid_token" />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", callbackURL: "/verify-email" }),
    );
  });

  it("shows an error message when resend rejects", async () => {
    sendVerificationEmail.mockRejectedValue(new Error("boom"));
    render(<VerifyEmailClient error="invalid_token" />);
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
    render(<VerifyEmailClient error="invalid_token" />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /resend/i }));
    await waitFor(() => {
      expect(screen.getByText(/check your inbox/i)).toBeTruthy();
    });
  });
});
