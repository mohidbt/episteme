// GSD-126 P1a — shared client util that detects HTTP 402 trial_exhausted
// responses from any AI-serving route, surfaces a single de-duplicated
// sonner toast, and lets callsites short-circuit by catching
// TrialExhaustedError.
//
// The toast helper de-duplicates per browser tab using sessionStorage
// (5 min window) so a chat with N failed tool calls only shows ONE toast.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toast } from "sonner";

import {
  TrialExhaustedError,
  fetchOrThrowTrialExhausted,
  surfaceTrialExhaustedToast,
  TRIAL_EXHAUSTED_TOAST_COPY,
  TRIAL_EXHAUSTED_DEDUP_KEY,
  TRIAL_EXHAUSTED_DEDUP_MS,
} from "../trial-exhausted";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

// sessionStorage is not provided by vitest's node env. Install a minimal
// shim before each test so the dedup window is testable without jsdom.
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
  // Cast: the global types do not always expose sessionStorage on the
  // Node-ish global object used by vitest.
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = fake;
}

beforeEach(() => {
  installSessionStorage();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TrialExhaustedError", () => {
  it("is an Error subclass with a stable name", () => {
    const err = new TrialExhaustedError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TrialExhaustedError");
    expect(err.message).toBe("trial_exhausted");
  });
});

describe("fetchOrThrowTrialExhausted", () => {
  it("returns the response unchanged on 200", async () => {
    const fakeRes = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn(async () => fakeRes);
    const out = await fetchOrThrowTrialExhausted("/api/ai-fill", undefined, fetchImpl);
    expect(out).toBe(fakeRes);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns the response unchanged on a non-402 error status", async () => {
    const fakeRes = new Response(JSON.stringify({ error: "boom" }), {
      status: 500,
    });
    const fetchImpl = vi.fn(async () => fakeRes);
    const out = await fetchOrThrowTrialExhausted("/api/ai-fill", undefined, fetchImpl);
    expect(out).toBe(fakeRes);
  });

  it("throws TrialExhaustedError on 402 + { error: 'trial_exhausted' }", async () => {
    const fakeRes = new Response(
      JSON.stringify({ error: "trial_exhausted" }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
    const fetchImpl = vi.fn(async () => fakeRes);
    await expect(
      fetchOrThrowTrialExhausted("/api/ai-fill", undefined, fetchImpl),
    ).rejects.toBeInstanceOf(TrialExhaustedError);
  });

  it("returns the response unchanged on 402 with a different body", async () => {
    // A 402 from a non-trial source (rare but possible) must NOT be coerced
    // into TrialExhaustedError — that would surface the wrong toast.
    const fakeRes = new Response(JSON.stringify({ error: "other_402" }), {
      status: 402,
      headers: { "content-type": "application/json" },
    });
    const fetchImpl = vi.fn(async () => fakeRes);
    const out = await fetchOrThrowTrialExhausted("/api/ai-fill", undefined, fetchImpl);
    expect(out).toBe(fakeRes);
  });

  it("returns the response unchanged on 402 with non-JSON body", async () => {
    // Defensive: malformed/empty 402 body shouldn't crash the helper. The
    // resolver only throws when the contract is unambiguous.
    const fakeRes = new Response("<html>upstream</html>", { status: 402 });
    const fetchImpl = vi.fn(async () => fakeRes);
    const out = await fetchOrThrowTrialExhausted("/api/ai-fill", undefined, fetchImpl);
    expect(out).toBe(fakeRes);
  });

  it("clones the response before reading so the caller can still consume it", async () => {
    // If the helper drained the original body, the returned-on-non-402 path
    // would leak a half-read stream to the caller. Verify the contract by
    // making the caller .json() the response after the helper handled it.
    const fakeRes = new Response(JSON.stringify({ data: "x" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetchImpl = vi.fn(async () => fakeRes);
    const out = await fetchOrThrowTrialExhausted("/api/ai-fill", undefined, fetchImpl);
    const body = await out.json();
    expect(body).toEqual({ data: "x" });
  });

  it("propagates the init argument to the underlying fetch", async () => {
    const fakeRes = new Response("ok", { status: 200 });
    const fetchImpl = vi.fn(async () => fakeRes);
    const init = { method: "POST", body: "x" } satisfies RequestInit;
    await fetchOrThrowTrialExhausted("/api/ai-fill", init, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/api/ai-fill", init);
  });
});

describe("surfaceTrialExhaustedToast", () => {
  it("calls toast.error with the canonical copy on first invocation", () => {
    surfaceTrialExhaustedToast();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(TRIAL_EXHAUSTED_TOAST_COPY);
  });

  it("does not re-toast inside the dedup window", () => {
    surfaceTrialExhaustedToast();
    surfaceTrialExhaustedToast();
    surfaceTrialExhaustedToast();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("re-toasts once the dedup window has elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:00Z"));
    surfaceTrialExhaustedToast();
    expect(toast.error).toHaveBeenCalledTimes(1);

    // Advance just past the window.
    vi.setSystemTime(new Date(Date.now() + TRIAL_EXHAUSTED_DEDUP_MS + 1));
    surfaceTrialExhaustedToast();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("persists the last-shown timestamp in sessionStorage under a stable key", () => {
    surfaceTrialExhaustedToast();
    const raw = sessionStorage.getItem(TRIAL_EXHAUSTED_DEDUP_KEY);
    expect(raw).not.toBeNull();
    const parsed = Number(raw);
    expect(Number.isFinite(parsed)).toBe(true);
  });

  it("is a no-op (and does not throw) when sessionStorage is unavailable", () => {
    // Simulate SSR / private mode where sessionStorage access throws.
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(() => surfaceTrialExhaustedToast()).not.toThrow();
    // Toast still fires — dedup is best-effort, not a hard block.
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
