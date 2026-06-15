// @vitest-environment jsdom
// GSD-46 fix — referrals page must never dead-end on "Pick a username in
// account settings". The dead-end CTA pointed at /settings/account which has
// no username UI; instead the page now defensively backfills a derived
// username for legacy rows and renders codes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

const getCurrentSessionMock = vi.fn();
const ensureUserReferralCodesMock = vi.fn();
const listReferralCodesForUserMock = vi.fn();
const ensureUsernameMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getCurrentSession: () => getCurrentSessionMock(),
}));

vi.mock("@/lib/ensure-username", () => ({
  ensureUsername: (...args: unknown[]) => ensureUsernameMock(...args),
}));

vi.mock("@/lib/referral-codes", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/referral-codes")>(
      "@/lib/referral-codes",
    );
  return {
    ...actual,
    ensureUserReferralCodes: (...args: unknown[]) =>
      ensureUserReferralCodesMock(...args),
    listReferralCodesForUser: (...args: unknown[]) =>
      listReferralCodesForUserMock(...args),
  };
});

// next/link → plain anchor in test env.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ReferralsSettingsPage from "../page";

beforeEach(() => {
  getCurrentSessionMock.mockReset();
  ensureUserReferralCodesMock.mockReset();
  listReferralCodesForUserMock.mockReset();
  ensureUsernameMock.mockReset();
});

describe("ReferralsSettingsPage", () => {
  it("anonymous session renders the sign-up CTA", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_anon",
      isAnonymous: true,
    });

    const ui = await ReferralsSettingsPage();
    render(ui as React.ReactElement);

    expect(
      screen.getByTestId("settings-referrals-anon-signup-cta"),
    ).not.toBeNull();
    expect(ensureUsernameMock).not.toHaveBeenCalled();
  });

  it("legacy account with null username gets a derived username backfilled and codes rendered", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_legacy",
      isAnonymous: false,
    });
    ensureUsernameMock.mockResolvedValue("test-user");
    listReferralCodesForUserMock.mockResolvedValue([
      {
        code: "episteme-test-user-1",
        consumedByUserId: null,
        consumedAt: null,
        consumedByUsername: null,
      },
    ]);

    const ui = await ReferralsSettingsPage();
    render(ui as React.ReactElement);

    expect(ensureUsernameMock).toHaveBeenCalledWith("u_legacy");
    expect(ensureUserReferralCodesMock).toHaveBeenCalledWith(
      "u_legacy",
      "test-user",
    );
    // The dead-end "Pick a username" CTA is gone.
    expect(screen.queryByTestId("referrals-needs-username")).toBeNull();
    expect(screen.getByTestId("referrals-remaining").textContent).toMatch(
      /1 remaining/i,
    );
  });

  it("when ensureUsername can't claim one, renders a generic empty state (no dead-end link)", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_broken",
      isAnonymous: false,
    });
    ensureUsernameMock.mockResolvedValue(null);

    const ui = await ReferralsSettingsPage();
    render(ui as React.ReactElement);

    // No misleading "5 codes / 0 remaining" line.
    expect(screen.queryByTestId("referrals-remaining")).toBeNull();
    // No dead-end CTA pointing to /settings/account.
    expect(screen.queryByTestId("referrals-needs-username")).toBeNull();
    // Must not link to /settings/account anywhere.
    const links = screen.queryAllByRole("link");
    for (const link of links) {
      expect(link.getAttribute("href")).not.toBe("/settings/account");
    }
    expect(ensureUserReferralCodesMock).not.toHaveBeenCalled();
  });

  it("normal account with a username backfills codes and renders remaining count", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_real",
      isAnonymous: false,
    });
    ensureUsernameMock.mockResolvedValue("tom");
    listReferralCodesForUserMock.mockResolvedValue([
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
    ]);

    const ui = await ReferralsSettingsPage();
    render(ui as React.ReactElement);

    expect(ensureUserReferralCodesMock).toHaveBeenCalledWith("u_real", "tom");
    expect(screen.getByTestId("referrals-remaining").textContent).toMatch(
      /1 remaining/i,
    );
    expect(screen.getByTestId("referrals-list")).not.toBeNull();
  });
});
