// @vitest-environment jsdom
// GSD-46 fix — referrals page must not lie about "5 invite codes / 0 remaining"
// when the lazy backfill is silently skipped (e.g. legacy user with null username).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

const getCurrentSessionMock = vi.fn();
const ensureUserReferralCodesMock = vi.fn();
const listReferralCodesForUserMock = vi.fn();

// db.select(...).from(...).where(...).limit(...) — chainable thenable.
const dbUserRowMock = vi.fn();
function makeUserSelectChain() {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(dbUserRowMock()));
  return chain;
}

vi.mock("@/lib/session", () => ({
  getCurrentSession: () => getCurrentSessionMock(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => makeUserSelectChain()),
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
  dbUserRowMock.mockReset();
});

describe("ReferralsSettingsPage", () => {
  it("when username is null, does NOT claim '5 invite codes / 0 remaining' (GSD-46 bug)", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_legacy",
      isAnonymous: false,
    });
    dbUserRowMock.mockReturnValue([{ username: null }]);
    listReferralCodesForUserMock.mockResolvedValue([]);

    const ui = await ReferralsSettingsPage();
    render(ui as React.ReactElement);

    // Backfill skipped because no username.
    expect(ensureUserReferralCodesMock).not.toHaveBeenCalled();

    // The page must not contradict itself by promising 5 codes while showing 0.
    const remainingEl = screen.queryByTestId("referrals-remaining");
    expect(remainingEl, "must not show misleading 'N remaining' line").toBeNull();

    // It must show a clear set-username CTA or explanation.
    const cta = screen.queryByTestId("referrals-needs-username");
    expect(cta, "should surface a needs-username state").not.toBeNull();
  });

  it("when username is set, backfills + renders codes with accurate remaining count", async () => {
    getCurrentSessionMock.mockResolvedValue({
      userId: "u_real",
      isAnonymous: false,
    });
    dbUserRowMock.mockReturnValue([{ username: "tom" }]);
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
    expect(
      screen.getByTestId("referrals-remaining").textContent,
    ).toMatch(/1 remaining/i);
    expect(screen.getByTestId("referrals-list")).not.toBeNull();
  });
});
