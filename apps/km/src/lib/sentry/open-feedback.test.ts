import { describe, it, expect, vi, beforeEach } from "vitest";

const getFeedback = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  getFeedback: () => getFeedback(),
}));

beforeEach(() => {
  getFeedback.mockReset();
  vi.resetModules();
});

describe("openFeedbackDialog (GSD-220)", () => {
  it("creates, mounts, and opens the Sentry feedback form", async () => {
    const open = vi.fn();
    const appendToDom = vi.fn();
    const createForm = vi.fn().mockResolvedValue({ appendToDom, open });
    getFeedback.mockReturnValue({ createForm });

    const { openFeedbackDialog } = await import("./open-feedback");
    await openFeedbackDialog();

    expect(createForm).toHaveBeenCalledOnce();
    expect(appendToDom).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it("reuses one cached form across repeated opens (no DOM leak)", async () => {
    const open = vi.fn();
    const appendToDom = vi.fn();
    const createForm = vi.fn().mockResolvedValue({ appendToDom, open });
    getFeedback.mockReturnValue({ createForm });

    const { openFeedbackDialog } = await import("./open-feedback");
    await openFeedbackDialog();
    await openFeedbackDialog();

    expect(createForm).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("no-ops when the feedback integration is not registered", async () => {
    getFeedback.mockReturnValue(undefined);
    const { openFeedbackDialog } = await import("./open-feedback");
    await expect(openFeedbackDialog()).resolves.toBeUndefined();
  });
});
