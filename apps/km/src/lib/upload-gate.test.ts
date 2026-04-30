// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn() },
}));

import { toast } from "sonner";
import { showSignInToUpload } from "./upload-gate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("showSignInToUpload", () => {
  it("calls toast.error with a sign-in CTA action", () => {
    showSignInToUpload();
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    const [message, opts] = vi.mocked(toast.error).mock.calls[0];
    expect(String(message).toLowerCase()).toContain("sign in");
    const action = (opts as { action?: { label: string; onClick: () => void } } | undefined)
      ?.action;
    expect(action).toBeDefined();
    expect(action!.label.toLowerCase()).toContain("sign in");
  });
});
