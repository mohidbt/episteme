import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeShowGuestError } from "./guest-error";

const errorToast = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => errorToast(...args),
  },
}));

function mkRes(status: number): Response {
  return new Response(null, { status });
}

describe("maybeShowGuestError", () => {
  beforeEach(() => {
    errorToast.mockClear();
  });

  it("shows a guest-mode toast and returns true on 403 guest_forbidden", () => {
    const handled = maybeShowGuestError(mkRes(403), { error: "guest_forbidden" });
    expect(handled).toBe(true);
    expect(errorToast).toHaveBeenCalledTimes(1);
    const [title, opts] = errorToast.mock.calls[0] as [string, { description?: string }];
    expect(String(title).toLowerCase()).toContain("guest mode");
    expect(String(opts?.description ?? "").toLowerCase()).toContain("sign up");
  });

  it("returns false and shows no toast for a different 403 error code", () => {
    const handled = maybeShowGuestError(mkRes(403), { error: "validation" });
    expect(handled).toBe(false);
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("returns false and shows no toast for a non-403 status", () => {
    const handled = maybeShowGuestError(mkRes(500), { error: "guest_forbidden" });
    expect(handled).toBe(false);
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("returns false and shows no toast when body is null", () => {
    const handled = maybeShowGuestError(mkRes(403), null);
    expect(handled).toBe(false);
    expect(errorToast).not.toHaveBeenCalled();
  });
});
