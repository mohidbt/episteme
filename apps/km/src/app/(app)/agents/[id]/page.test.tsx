// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getRequiredUserId: vi.fn(async () => "u1"),
}));

vi.mock("@/lib/threads", () => ({
  getThread: vi.fn(),
}));

vi.mock("@/lib/agents/get-thread-messages", () => ({
  getThreadMessages: vi.fn(),
}));

// AgentTranscript pulls in heavy client-only deps (react-markdown, etc.).
// The page test only needs to verify the page's data-fetching shape.
vi.mock("@/components/agent/AgentTranscript", () => ({
  AgentTranscript: (props: Record<string, unknown>) => {
    // Render minimal marker so we can poke at it from the test.
    return Object.assign({}, props, { __type: "AgentTranscript" });
  },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { getThread } from "@/lib/threads";
import { getThreadMessages } from "@/lib/agents/get-thread-messages";
import AgentThreadPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/agents/[id] page", () => {
  it("renders AgentTranscript with persisted messages from getThreadMessages", async () => {
    vi.mocked(getThread).mockResolvedValue({
      userId: "u1",
      threadId: "thread-abc",
      modelOverride: null,
      title: null,
      skill: null,
      status: "idle",
      lastMessageAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const messages = [{ id: "m1", role: "user" as const, text: "hi" }];
    vi.mocked(getThreadMessages).mockResolvedValue(messages);

    const page = (await AgentThreadPage({
      params: Promise.resolve({ id: "thread-abc" }),
    })) as unknown as { props: { children: { props: Record<string, unknown> } } };

    // The rendered tree is <div><AgentTranscript .../></div>; pull props off the child.
    const transcriptProps = page.props.children.props;
    expect(transcriptProps.threadId).toBe("thread-abc");
    expect(transcriptProps.initialMessages).toEqual(messages);

    expect(getThreadMessages).toHaveBeenCalledWith("u1", "thread-abc");
  });

  it("fetches thread + messages concurrently (Promise.all, not sequential)", async () => {
    // Both mocks resolve after a delay. If the page awaits sequentially,
    // total time >= 2 * delay. If parallel via Promise.all, total time ~= delay.
    const DELAY = 60;
    vi.mocked(getThread).mockImplementation(
      () =>
        new Promise((r) =>
          setTimeout(
            () =>
              r({
                userId: "u1",
                threadId: "thread-abc",
                modelOverride: null,
                title: null,
                skill: null,
                status: "idle",
                lastMessageAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            DELAY,
          ),
        ),
    );
    vi.mocked(getThreadMessages).mockImplementation(
      () => new Promise((r) => setTimeout(() => r([]), DELAY)),
    );

    const start = Date.now();
    await AgentThreadPage({ params: Promise.resolve({ id: "thread-abc" }) });
    const elapsed = Date.now() - start;

    // Allow generous slack but reject anything that smells sequential.
    // Sequential would be ~120ms; parallel ~60ms. Threshold at 100ms.
    expect(elapsed).toBeLessThan(100);
  });

  it("calls getThread and getThreadMessages without waiting on each other", async () => {
    // Stronger assertion: getThreadMessages must be called BEFORE getThread resolves.
    let getThreadResolve!: (v: Awaited<ReturnType<typeof getThread>>) => void;
    const getThreadPromise = new Promise<Awaited<ReturnType<typeof getThread>>>(
      (r) => {
        getThreadResolve = r;
      },
    );
    vi.mocked(getThread).mockReturnValue(getThreadPromise);
    vi.mocked(getThreadMessages).mockResolvedValue([]);

    const pagePromise = AgentThreadPage({
      params: Promise.resolve({ id: "thread-abc" }),
    });

    // Yield microtasks so the page body can dispatch both calls.
    await new Promise((r) => setTimeout(r, 10));
    expect(getThreadMessages).toHaveBeenCalledTimes(1);

    // Now resolve getThread so the page can finish.
    getThreadResolve({
      userId: "u1",
      threadId: "thread-abc",
      modelOverride: null,
      title: null,
      skill: null,
      status: "idle",
      lastMessageAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await pagePromise;
  });
});
