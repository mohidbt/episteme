// GSD-139 — usage-threshold notifier. When a SIGNED-IN user's OpenRouter
// managed-bucket spend crosses 70%, then 90%, of their soft limit, surface a
// single non-blocking toast nudging subscribe — BEFORE the hard 402
// trial-exhausted at 100%. Guests are out of scope (GSD-130 handles them).
//
// Dedup mirrors trial-exhausted.ts: two independent sessionStorage keys (70/90)
// so each threshold fires at most once per browser tab and crossing 90 does not
// re-fire 70.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";

import {
  maybeNotifyUsageThreshold,
  USAGE_THRESHOLD_70_KEY,
  USAGE_THRESHOLD_90_KEY,
  USAGE_THRESHOLD_70_COPY,
  USAGE_THRESHOLD_90_COPY,
  USAGE_THRESHOLD_CTA_LABEL,
  USAGE_THRESHOLD_CTA_HREF,
  __resetUsageThrottleForTest,
} from "../trial-exhausted";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// sessionStorage shim — vitest node env doesn't provide it.
function installSessionStorage() {
  const store = new Map<string, string>();
  const fake: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
  };
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = fake;
}

// Build a usage-endpoint fetch stub returning the given spend/limit/guest flag.
function usageFetch(opts: {
  totalUsd: number;
  limitUsd: number;
  isGuest?: boolean;
}): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        totalUsd: opts.totalUsd,
        limitUsd: opts.limitUsd,
        isGuest: opts.isGuest ?? false,
        byModel: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  installSessionStorage();
  vi.mocked(toast.warning).mockClear();
  __resetUsageThrottleForTest();
});

describe("maybeNotifyUsageThreshold", () => {
  it("does nothing below 70%", async () => {
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3, limitUsd: 5 }));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("fires the 70% toast once when crossing 70%", async () => {
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.6, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const [copy] = vi.mocked(toast.warning).mock.calls[0] as [string, unknown];
    expect(copy).toBe(USAGE_THRESHOLD_70_COPY);
  });

  it("does not re-fire 70% on repeated calls at 72% (dedup, throttle bypassed)", async () => {
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.6, limitUsd: 5 }));
    __resetUsageThrottleForTest();
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.65, limitUsd: 5 }));
    __resetUsageThrottleForTest();
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.7, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("fires the 90% toast once when crossing 90% (with a Subscribe CTA)", async () => {
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 4.6, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const [copy, opts] = vi.mocked(toast.warning).mock.calls[0] as [
      string,
      { action?: { label: string; onClick: () => void } } | undefined,
    ];
    expect(copy).toBe(USAGE_THRESHOLD_90_COPY);
    expect(opts?.action?.label).toBe(USAGE_THRESHOLD_CTA_LABEL);
    expect(typeof opts?.action?.onClick).toBe("function");
    // Crossing 90 first must also mark the 70 key so a later sub-90 read
    // can't retroactively fire the gentler toast.
    expect(sessionStorage.getItem(USAGE_THRESHOLD_70_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(USAGE_THRESHOLD_90_KEY)).not.toBeNull();
  });

  it("crossing 90 does not re-fire 70 afterward", async () => {
    // Already above 90% on first call: 90 fires. A later call still above 70
    // (but the 90 key already set) must NOT fire the 70 toast.
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 4.6, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    __resetUsageThrottleForTest();
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 4.7, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("fires 70 first, then 90 on a later crossing — two distinct toasts", async () => {
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.6, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(
      (vi.mocked(toast.warning).mock.calls[0] as [string])[0],
    ).toBe(USAGE_THRESHOLD_70_COPY);
    __resetUsageThrottleForTest();
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 4.6, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(
      (vi.mocked(toast.warning).mock.calls[1] as [string])[0],
    ).toBe(USAGE_THRESHOLD_90_COPY);
  });

  it("rapid 70→90 within the throttle window still escalates (70-fire clears throttle)", async () => {
    // First call crosses 70 — fires 70 AND clears the fetch throttle.
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.6, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    // Immediate second call (no manual throttle reset) crosses 90 — must
    // re-fetch and fire the 90 toast despite being inside the 60s window.
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 4.6, limitUsd: 5 }));
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(
      (vi.mocked(toast.warning).mock.calls[1] as [string])[0],
    ).toBe(USAGE_THRESHOLD_90_COPY);
  });

  it("never fires for a guest, at any pct", async () => {
    await maybeNotifyUsageThreshold(
      usageFetch({ totalUsd: 0.95, limitUsd: 1, isGuest: true }),
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("persists the threshold flag in sessionStorage under stable keys", async () => {
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.6, limitUsd: 5 }));
    expect(sessionStorage.getItem(USAGE_THRESHOLD_70_KEY)).not.toBeNull();
    __resetUsageThrottleForTest();
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 4.6, limitUsd: 5 }));
    expect(sessionStorage.getItem(USAGE_THRESHOLD_90_KEY)).not.toBeNull();
  });

  it("throttles the usage fetch within the 60s window (no second network call)", async () => {
    const fetchSpy = usageFetch({ totalUsd: 3, limitUsd: 5 });
    await maybeNotifyUsageThreshold(fetchSpy);
    // Second call without resetting the throttle: must short-circuit before fetch.
    await maybeNotifyUsageThreshold(fetchSpy);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when sessionStorage is unavailable", async () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    await expect(
      maybeNotifyUsageThreshold(usageFetch({ totalUsd: 3.6, limitUsd: 5 })),
    ).resolves.toBeUndefined();
  });

  it("does nothing when the usage fetch fails (best-effort, never blocks)", async () => {
    const failing = vi.fn(async () =>
      new Response("boom", { status: 500 }),
    ) as unknown as typeof fetch;
    await maybeNotifyUsageThreshold(failing);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("guards against limitUsd of 0 (no divide-by-zero toast)", async () => {
    await maybeNotifyUsageThreshold(usageFetch({ totalUsd: 5, limitUsd: 0 }));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("CTA href points to /sign-up (TODO: /settings/billing post-GSD-141)", () => {
    expect(USAGE_THRESHOLD_CTA_HREF).toBe("/sign-up");
  });
});
