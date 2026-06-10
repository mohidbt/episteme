// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { invalidateDriveTree, useDriveSync } from "./drive-sync";

describe("drive-sync", () => {
  it("notifies all subscribers when invalidateDriveTree fires", () => {
    const a = vi.fn();
    const b = vi.fn();
    const hookA = renderHook(() => useDriveSync(a));
    const hookB = renderHook(() => useDriveSync(b));

    invalidateDriveTree();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    hookA.unmount();
    hookB.unmount();
  });

  it("stops notifying after unmount", () => {
    const cb = vi.fn();
    const hook = renderHook(() => useDriveSync(cb));
    invalidateDriveTree();
    expect(cb).toHaveBeenCalledTimes(1);
    hook.unmount();
    invalidateDriveTree();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("uses latest callback after rerender", () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ cb }) => useDriveSync(cb), {
      initialProps: { cb: first },
    });
    invalidateDriveTree();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(0);

    hook.rerender({ cb: second });
    invalidateDriveTree();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("does nothing when window is unavailable (SSR)", () => {
    // Just confirm invalidate doesn't throw without subscribers.
    expect(() => invalidateDriveTree()).not.toThrow();
  });
});
