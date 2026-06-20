// @vitest-environment node
// GSD-130 — server-enforced $1 soft cap for anonymous (guest) AI usage.
//
// Reuses openrouter_usage rows summed over the same 7-day window the
// /settings/data guest panel reads, so the bar + the gate agree on the
// same number.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openrouter-usage", () => ({
  getRecentSpendUsd: vi.fn(),
  OR_GUEST_SOFT_LIMIT_USD: 1,
}));

import { getRecentSpendUsd } from "../openrouter-usage";
import {
  assertGuestNotExhausted,
  GuestTrialExhausted,
} from "../guest-cap";

const mockedGetSpend = vi.mocked(getRecentSpendUsd);

beforeEach(() => {
  mockedGetSpend.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertGuestNotExhausted", () => {
  it("is a no-op for signed-in (non-anonymous) sessions", async () => {
    // Should never even query usage for signed-in users — they have their
    // own managed-bucket cap path via OR's reported usage.
    await expect(
      assertGuestNotExhausted({ userId: "u1", isAnonymous: false }),
    ).resolves.toBeUndefined();
    expect(mockedGetSpend).not.toHaveBeenCalled();
  });

  it("does not throw when guest spend is below the $1 cap", async () => {
    mockedGetSpend.mockResolvedValue({ totalUsd: 0.5, byModel: [] });
    await expect(
      assertGuestNotExhausted({ userId: "guest-1", isAnonymous: true }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when guest spend is just under the cap", async () => {
    mockedGetSpend.mockResolvedValue({ totalUsd: 0.999999, byModel: [] });
    await expect(
      assertGuestNotExhausted({ userId: "guest-1", isAnonymous: true }),
    ).resolves.toBeUndefined();
  });

  it("throws GuestTrialExhausted at exactly $1", async () => {
    mockedGetSpend.mockResolvedValue({ totalUsd: 1.0, byModel: [] });
    await expect(
      assertGuestNotExhausted({ userId: "guest-1", isAnonymous: true }),
    ).rejects.toBeInstanceOf(GuestTrialExhausted);
  });

  it("throws GuestTrialExhausted when guest spend exceeds the cap", async () => {
    mockedGetSpend.mockResolvedValue({ totalUsd: 1.5, byModel: [] });
    await expect(
      assertGuestNotExhausted({ userId: "guest-1", isAnonymous: true }),
    ).rejects.toBeInstanceOf(GuestTrialExhausted);
  });

  it("queries spend scoped to the guest session id over a 7-day window", async () => {
    mockedGetSpend.mockResolvedValue({ totalUsd: 0, byModel: [] });
    await assertGuestNotExhausted({ userId: "guest-xyz", isAnonymous: true });
    expect(mockedGetSpend).toHaveBeenCalledWith(null, "guest-xyz", 7);
  });
});

describe("GuestTrialExhausted error", () => {
  it("is an Error subclass with a stable name", () => {
    const err = new GuestTrialExhausted();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GuestTrialExhausted");
  });
});
