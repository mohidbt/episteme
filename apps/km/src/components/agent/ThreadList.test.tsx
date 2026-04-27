// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  act,
} from "@testing-library/react";
import { ThreadList } from "./ThreadList";
import type { AgentThreadRow } from "@/lib/threads";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function makeThread(overrides: Partial<AgentThreadRow> = {}): AgentThreadRow {
  return {
    userId: "u-1",
    threadId: "thread-abcdef1234567890",
    modelOverride: null,
    title: null,
    skill: null,
    status: "idle",
    lastMessageAt: null,
    createdAt: new Date("2026-04-01T00:00:00Z"),
    updatedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  push.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ threads: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ThreadList", () => {
  it("renders empty state when no threads", () => {
    render(<ThreadList initialThreads={[]} />);
    expect(screen.getByText(/No conversations yet/i)).toBeTruthy();
  });

  it("renders one row per thread", () => {
    render(
      <ThreadList
        initialThreads={[
          makeThread({ threadId: "t-1", title: "Hello" }),
          makeThread({ threadId: "t-2-zzzzzzzzzzzz", title: null }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("thread-row");
    expect(rows.length).toBe(2);
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText(/Conversation #t-2-zzzz/)).toBeTruthy();
  });

  it("renders status chips matching status enum", () => {
    render(
      <ThreadList
        initialThreads={[
          makeThread({ threadId: "t-idle", status: "idle" }),
          makeThread({ threadId: "t-run", status: "running" }),
          makeThread({ threadId: "t-hitl", status: "awaiting_hitl" }),
          makeThread({ threadId: "t-err", status: "error" }),
        ]}
      />,
    );
    const chips = screen.getAllByTestId("status-chip");
    const statuses = chips.map((c) => c.getAttribute("data-status"));
    expect(statuses).toEqual(["idle", "running", "awaiting_hitl", "error"]);
  });

  it("polls /api/agent/threads every 5s", async () => {
    render(
      <ThreadList
        initialThreads={[makeThread({ threadId: "t-1", title: "Hi" })]}
      />,
    );
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent/threads",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("stops polling when document hidden", async () => {
    render(
      <ThreadList
        initialThreads={[makeThread({ threadId: "t-1", title: "Hi" })]}
      />,
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
