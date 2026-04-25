// @vitest-environment jsdom
import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const refresh = vi.fn();
const anonymous = vi.fn(async () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {} }),
}));

vi.mock("@episteme/auth/client", () => ({
  signIn: { anonymous },
}));

afterEach(async () => {
  cleanup();
  refresh.mockClear();
  anonymous.mockClear();
  const { __resetInFlightForTests } = await import("./AnonAutoSignIn");
  __resetInFlightForTests();
});

describe("AnonAutoSignIn", () => {
  it("calls signIn.anonymous() then router.refresh() on mount", async () => {
    const { AnonAutoSignIn } = await import("./AnonAutoSignIn");
    render(<AnonAutoSignIn />);
    await waitFor(() => {
      expect(anonymous).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("renders a loading state (not null)", async () => {
    const { AnonAutoSignIn } = await import("./AnonAutoSignIn");
    const { container } = render(<AnonAutoSignIn />);
    expect(container.firstChild).not.toBeNull();
    expect(container.textContent).toContain("Setting up your workspace");
  });

  it("dedupes StrictMode double-mount: signIn.anonymous called exactly once", async () => {
    const { AnonAutoSignIn } = await import("./AnonAutoSignIn");
    render(
      <StrictMode>
        <AnonAutoSignIn />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(anonymous).toHaveBeenCalledTimes(1);
    });
  });
});
