// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => cleanup());
import { ReferralsList } from "../ReferralsList";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const baseRows = [
  {
    code: "episteme-tom-1",
    consumedByUserId: null,
    consumedAt: null,
    consumedByUsername: null,
  },
  {
    code: "episteme-tom-2",
    consumedByUserId: "u_alice",
    consumedAt: new Date(),
    consumedByUsername: "alice",
  },
];

describe("ReferralsList", () => {
  it("renders one row per code", () => {
    render(<ReferralsList codes={baseRows} />);
    expect(screen.getByTestId("referral-row-episteme-tom-1")).not.toBeNull();
    expect(screen.getByTestId("referral-row-episteme-tom-2")).not.toBeNull();
  });

  it("shows Available for unused codes", () => {
    render(<ReferralsList codes={baseRows} />);
    expect(
      screen.getByTestId("referral-status-episteme-tom-1").textContent,
    ).toMatch(/available/i);
  });

  it("shows Redeemed by @username for consumed codes", () => {
    render(<ReferralsList codes={baseRows} />);
    expect(
      screen.getByTestId("referral-status-episteme-tom-2").textContent,
    ).toMatch(/redeemed by @alice/i);
  });

  it("disables the copy button on consumed codes", () => {
    render(<ReferralsList codes={baseRows} />);
    const consumedCopy = screen.getByTestId("referral-copy-episteme-tom-2");
    expect((consumedCopy as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes the code to clipboard on copy click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ReferralsList codes={baseRows} />);
    fireEvent.click(screen.getByTestId("referral-copy-episteme-tom-1"));
    // microtask drain
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("episteme-tom-1");
  });

  it("renders an empty-state message when no codes", () => {
    render(<ReferralsList codes={[]} />);
    expect(screen.getByTestId("referrals-empty")).not.toBeNull();
  });
});
