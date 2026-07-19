// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

const getCurrentSessionMock = vi.fn();
const requireVerifiedSessionMock = vi.fn();
const ensureUserReferralCodesMock = vi.fn();
const listReferralCodesForUserMock = vi.fn();
const dbSelectMock = vi.fn();

// Mirror next/navigation redirect() throwing to unwind the render.
class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock("@/lib/session", () => ({
  getCurrentSession: () => getCurrentSessionMock(),
  requireVerifiedSession: () => requireVerifiedSessionMock(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => dbSelectMock(),
        }),
      }),
    }),
  },
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
  requireVerifiedSessionMock.mockReset();
  ensureUserReferralCodesMock.mockReset();
  listReferralCodesForUserMock.mockReset();
  dbSelectMock.mockReset();
  // Default: verified real user (the gate passes through). Individual tests
  // override this to assert the unverified-redirect path.
  requireVerifiedSessionMock.mockResolvedValue(undefined);
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
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it("renders codes for signed-in user with username", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_real",
      isAnonymous: false,
    });
    dbSelectMock.mockResolvedValue([{ username: "tom" }]);
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

  it("redirects an unverified real user before any protected DB read (GSD-142)", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_unverified",
      isAnonymous: false,
    });
    // The gate throws (redirect) for an unverified real user.
    requireVerifiedSessionMock.mockRejectedValue(
      new RedirectError("/verify-email"),
    );

    await expect(ReferralsSettingsPage()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it("throws when signed-in user has no username (invariant violation)", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_broken",
      isAnonymous: false,
    });
    dbSelectMock.mockResolvedValue([{ username: null }]);

    await expect(ReferralsSettingsPage()).rejects.toThrow(/no username/i);
  });
});
