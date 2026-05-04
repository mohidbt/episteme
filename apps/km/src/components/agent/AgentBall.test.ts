// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AgentBall } from "./AgentBall";
import { AgentBallProvider } from "./agent-ball-context";
import { computeBottomSnapTop } from "@/hooks/useDragX";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("./AgentTranscript", async () => {
  const ReactMod = await import("react");
  return {
    AgentTranscript: (props: { onBeforeSendMessage?: (text: string) => Promise<void> | void }) =>
      ReactMod.createElement(
        "button",
        {
          type: "button",
          "data-testid": "stub-send",
          onClick: () =>
            props.onBeforeSendMessage?.(
              "This is the very first prompt from the user and it should become the thread title",
            ),
        },
        "send",
      ),
  };
});

function renderBall() {
  return render(
    React.createElement(
      AgentBallProvider,
      null,
      React.createElement(AgentBall, { userId: "u1" }),
    ),
  );
}

describe("AgentBall targeted regressions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("drop-y snap math uses center anchor (not bottom anchor)", () => {
    const y = computeBottomSnapTop(800, 40, 0.12);
    expect(y).toBe(684);
    expect(y).not.toBe(664);
  });

  it("renames a new uuid-prefixed thread title from the first prompt", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/agent/threads" && init?.method === "POST") {
        return new Response(JSON.stringify({ thread: { threadId: "t-new" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/agent/threads/t-new" && !init?.method) {
        return new Response(
          JSON.stringify({
            thread: { title: "123e4567-e89b-12d3-a456-426614174000:t-new" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "/api/agent/threads/t-new" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ thread: { threadId: "t-new" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("stub-send")).toBeTruthy());

    fireEvent.click(screen.getByTestId("stub-send"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((call) => {
        const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
        const url = typeof input === "string" ? input : input.toString();
        return url === "/api/agent/threads/t-new" && init?.method === "PATCH";
      });
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(String((patchCall as [RequestInfo | URL, RequestInit])[1].body));
      expect(body.title).toBe(
        "This is the very first prompt from the user and it should be",
      );
      expect(body.title.length).toBe(60);
    });
  });

  it("does not rename when thread already has a real name", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/agent/threads" && init?.method === "POST") {
        return new Response(JSON.stringify({ thread: { threadId: "t-existing" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/agent/threads/t-existing" && !init?.method) {
        return new Response(JSON.stringify({ thread: { title: "Research Plan" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });

    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("stub-send")).toBeTruthy());

    fireEvent.click(screen.getByTestId("stub-send"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((call) => {
        const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
        const url = typeof input === "string" ? input : input.toString();
        return url === "/api/agent/threads/t-existing" && init?.method === "PATCH";
      });
      expect(patchCall).toBeUndefined();
    });
  });

  it("keeps collapsed ball draggable after expand then collapse", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ thread: { threadId: "t-drag" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());

    fireEvent.click(screen.getByTestId("agent-collapse"));
    const collapsed = await waitFor(() => screen.getByTestId("agent-ball-collapsed"));

    expect(collapsed.className).toContain("touch-none");
    fireEvent.pointerDown(collapsed, { clientX: 200, clientY: 760, pointerId: 1 });
    fireEvent.pointerMove(collapsed, { clientX: 360, clientY: 760, pointerId: 1 });
    fireEvent.pointerUp(collapsed, { clientX: 360, clientY: 760, pointerId: 1 });

    expect(collapsed.getAttribute("style") || "").toContain("left:");
  });
});
