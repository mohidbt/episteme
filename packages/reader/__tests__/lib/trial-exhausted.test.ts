// GSD-126 P1a — smoke test for the reader-package mirror of the
// trial-exhausted util. apps/km owns the full 13-case suite; here we
// just confirm the contract still holds after the source copy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toast } from "sonner";

import {
  TrialExhaustedError,
  fetchOrThrowTrialExhausted,
  surfaceTrialExhaustedToast,
  TRIAL_EXHAUSTED_TOAST_COPY,
  TRIAL_EXHAUSTED_DEDUP_KEY,
  TRIAL_EXHAUSTED_DEDUP_MS,
} from "../../src/lib/trial-exhausted";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trial-exhausted (reader mirror)", () => {
  it("TrialExhaustedError is named and message stable", () => {
    const err = new TrialExhaustedError();
    expect(err.name).toBe("TrialExhaustedError");
    expect(err.message).toBe("trial_exhausted");
  });

  it("fetchOrThrowTrialExhausted passes through 200", async () => {
    const fakeRes = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn(async () => fakeRes);
    const out = await fetchOrThrowTrialExhausted("/x", undefined, fetchImpl);
    expect(out).toBe(fakeRes);
  });

  it("fetchOrThrowTrialExhausted throws on 402 + trial_exhausted body", async () => {
    const fakeRes = new Response(
      JSON.stringify({ error: "trial_exhausted" }),
      { status: 402 },
    );
    const fetchImpl = vi.fn(async () => fakeRes);
    await expect(
      fetchOrThrowTrialExhausted("/x", undefined, fetchImpl),
    ).rejects.toBeInstanceOf(TrialExhaustedError);
  });

  it("fetchOrThrowTrialExhausted passes through 402 with non-matching body", async () => {
    const fakeRes = new Response(JSON.stringify({ error: "other" }), {
      status: 402,
    });
    const fetchImpl = vi.fn(async () => fakeRes);
    const out = await fetchOrThrowTrialExhausted("/x", undefined, fetchImpl);
    expect(out).toBe(fakeRes);
  });

  it("surfaceTrialExhaustedToast fires once and dedups inside the window", () => {
    surfaceTrialExhaustedToast();
    surfaceTrialExhaustedToast();
    surfaceTrialExhaustedToast();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(TRIAL_EXHAUSTED_TOAST_COPY);
  });

  it("surfaceTrialExhaustedToast re-fires after the dedup window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:00Z"));
    surfaceTrialExhaustedToast();
    vi.setSystemTime(new Date(Date.now() + TRIAL_EXHAUSTED_DEDUP_MS + 1));
    surfaceTrialExhaustedToast();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("stores the last-shown timestamp under the canonical session key", () => {
    surfaceTrialExhaustedToast();
    expect(sessionStorage.getItem(TRIAL_EXHAUSTED_DEDUP_KEY)).not.toBeNull();
  });
});
