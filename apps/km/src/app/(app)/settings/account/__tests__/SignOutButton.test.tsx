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

const signOut = vi.fn();
const replace = vi.fn();

vi.mock("@episteme/auth/client", () => ({
  authClient: {
    signOut: (...args: unknown[]) => signOut(...args),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

import { SignOutButton } from "../SignOutButton";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  signOut.mockReset();
  replace.mockReset();
});

describe("SignOutButton", () => {
  it("calls authClient.signOut and redirects to / on click", async () => {
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    render(<SignOutButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    });
    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/");
    });
  });
});
