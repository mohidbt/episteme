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

let threadCounter = 0;

beforeEach(() => {
  threadCounter = 0;
  // Mock fetch for thread bootstrap; AgentTranscript fetch happens only on send.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agent/threads") && init?.method === "POST") {
        threadCounter += 1;
        return new Response(
          JSON.stringify({ thread: { threadId: `t-${threadCounter}` } }),
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

function countThreadCreatePosts(): number {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.filter((call) => {
    const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
    const url = typeof input === "string" ? input : input.toString();
    return url.includes("/api/agent/threads") && init?.method === "POST";
  }).length;
}

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

  it("POSTs to /api/agent/threads on open to create a fresh thread", async () => {
    render(<AgentBall userId="u1" />);
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(countThreadCreatePosts()).toBe(1));
  });

  it("closes on X click", async () => {
    render(<AgentBall userId="u1" />);
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Close agent"));
    await waitFor(() =>
      expect(screen.queryByTestId("agent-panel")).toBeNull(),
    );
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

  it("creates a new thread on each reopen (no resume)", async () => {
    render(<AgentBall userId="u1" />);
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(countThreadCreatePosts()).toBe(1));
    fireEvent.click(screen.getByLabelText("Close agent"));
    await waitFor(() =>
      expect(screen.queryByTestId("agent-panel")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(countThreadCreatePosts()).toBe(2));
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
