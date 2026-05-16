// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

const changePassword = vi.fn();

vi.mock("@episteme/auth/client", () => ({
  authClient: {
    changePassword: (...args: unknown[]) => changePassword(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";
import { AccountForms } from "../AccountForms";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  changePassword.mockReset();
});

function fillForm({
  current,
  next,
  confirm,
}: {
  current: string;
  next: string;
  confirm: string;
}) {
  fireEvent.change(screen.getByLabelText(/current password/i), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText(/^new password/i), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), {
    target: { value: confirm },
  });
}

describe("AccountForms — change password", () => {
  it("shows error and does not call API when confirm does not match", async () => {
    render(<AccountForms />);
    fillForm({ current: "oldpass12", next: "newpass12", confirm: "different1" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeTruthy();
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("shows error and does not call API when new password is too short", async () => {
    render(<AccountForms />);
    fillForm({ current: "oldpass12", next: "ab1", confirm: "ab1" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeTruthy();
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("calls authClient.changePassword with correct args on valid submit", async () => {
    changePassword.mockResolvedValue({ data: {}, error: null });
    render(<AccountForms />);
    fillForm({
      current: "oldpass12",
      next: "newpass12",
      confirm: "newpass12",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: "oldpass12",
        newPassword: "newpass12",
        revokeOtherSessions: true,
      });
      expect(toast.success).toHaveBeenCalledWith("Password updated");
    });
  });

  it("calls toast.error when server returns an error", async () => {
    changePassword.mockResolvedValue({
      data: null,
      error: { message: "Current password is incorrect" },
    });
    render(<AccountForms />);
    fillForm({
      current: "wrongpass",
      next: "newpass12",
      confirm: "newpass12",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    });
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Current password is incorrect");
    });
  });
});
