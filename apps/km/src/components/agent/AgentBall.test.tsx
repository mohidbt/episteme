// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { AgentBall } from "./AgentBall";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

beforeEach(() => {
  try {
    window.localStorage.removeItem("episteme.agent.lastThread");
  } catch {
    // ignore
  }
  // Mock fetch for thread bootstrap; AgentTranscript fetch happens only on send.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agent/threads")) {
        return new Response(
          JSON.stringify({ threads: [{ id: "t-1" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentBall", () => {
  it("renders closed (ball visible, panel hidden)", () => {
    render(<AgentBall userId="u1" />);
    expect(screen.getByTestId("agent-ball")).toBeTruthy();
    expect(screen.queryByTestId("agent-panel")).toBeNull();
  });

  it("opens on click", async () => {
    render(<AgentBall userId="u1" />);
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
  });

  it("closes on Escape", async () => {
    render(<AgentBall userId="u1" />);
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() =>
      expect(screen.queryByTestId("agent-panel")).toBeNull(),
    );
  });

  it("toggles on double-tap Space", async () => {
    render(<AgentBall userId="u1" />);
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: " ", code: "Space" });
      fireEvent.keyDown(document, { key: " ", code: "Space" });
    });
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
  });
});
