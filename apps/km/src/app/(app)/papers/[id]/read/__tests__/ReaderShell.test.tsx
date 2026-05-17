// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const searchParamsRef: { value: URLSearchParams } = { value: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.value,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = () => <div data-testid="reader-stub" />;
    return Stub;
  },
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

vi.mock("@/components/agent/AgentTranscript", () => ({
  AgentTranscript: () => <div data-testid="agent-transcript" />,
}));

vi.mock("@/state/agent-ball", () => ({
  useAgentBallStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        panelOpen: false,
        mountPoint: "reader-side-panel",
        activeThreadId: null,
        openInReader: () => {},
        close: () => {},
      }),
    {
      getState: () => ({
        activeThreadId: null,
        setActiveThread: () => {},
        close: () => {},
      }),
    },
  ),
}));

afterEach(() => {
  cleanup();
  searchParamsRef.value = new URLSearchParams();
});

describe("ReaderShell ?p= deep link (BG2a)", () => {
  it("dispatches episteme:reader-jump with page from ?p= on mount", async () => {
    searchParamsRef.value = new URLSearchParams("p=3");
    const events: CustomEvent[] = [];
    const handler = (ev: Event) => events.push(ev as CustomEvent);
    window.addEventListener("episteme:reader-jump", handler as EventListener);

    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-1" />);

    await waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
    const detail = events[0].detail as { page: number };
    expect(detail.page).toBe(3);
    window.removeEventListener("episteme:reader-jump", handler as EventListener);
  });

  it("does not dispatch when ?p= is absent", async () => {
    const events: CustomEvent[] = [];
    const handler = (ev: Event) => events.push(ev as CustomEvent);
    window.addEventListener("episteme:reader-jump", handler as EventListener);

    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-2" />);

    // Give the microtask a tick.
    await new Promise((r) => setTimeout(r, 20));
    expect(events.length).toBe(0);
    window.removeEventListener("episteme:reader-jump", handler as EventListener);
  });

  it("does not dispatch for invalid ?p= (e.g. p=0, p=abc)", async () => {
    searchParamsRef.value = new URLSearchParams("p=0");
    const events: CustomEvent[] = [];
    const handler = (ev: Event) => events.push(ev as CustomEvent);
    window.addEventListener("episteme:reader-jump", handler as EventListener);

    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-3" />);

    await new Promise((r) => setTimeout(r, 20));
    expect(events.length).toBe(0);
    window.removeEventListener("episteme:reader-jump", handler as EventListener);
  });
});
