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
import { AgentBallProvider, useAgentBall } from "./agent-ball-context";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// AgentTranscript pulls in heavy stream/fetch logic; stub it so tests stay
// focused on AgentBall's own behavior (preset, position, open/close, threads).
// The stub holds local state (a draft input) so we can verify the transcript
// stays mounted across collapse/expand cycles (G10 important #1).
vi.mock("./AgentTranscript", async () => {
  const React = await import("react");
  return {
    AgentTranscript: () => {
      const [draft, setDraft] = React.useState("");
      return (
        <div data-testid="agent-transcript-stub">
          <input
            data-testid="agent-draft-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
      );
    },
  };
});

let threadCounter = 0;

beforeEach(() => {
  threadCounter = 0;
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

function renderBall() {
  return render(
    <AgentBallProvider>
      <AgentBall userId="u1" />
    </AgentBallProvider>,
  );
}

describe("AgentBall", () => {
  it("renders closed with inactive preset by default", () => {
    renderBall();
    const ball = screen.getByTestId("agent-ball");
    expect(ball).toBeTruthy();
    expect(ball.getAttribute("data-preset")).toBe("inactive");
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    expect(screen.getByTestId("agent-matrix-inactive")).toBeTruthy();
  });

  it("is positioned centered on the bottom of the screen", () => {
    renderBall();
    const ball = screen.getByTestId("agent-ball");
    const cls = ball.className;
    expect(cls).toContain("fixed");
    expect(cls).toContain("bottom-4");
    expect(cls).toContain("left-1/2");
    expect(cls).toContain("-translate-x-1/2");
    expect(cls).not.toMatch(/\bright-4\b/);
  });

  it("switches to the active preset when the panel is open", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    const panel = await waitFor(() => screen.getByTestId("agent-panel"));
    expect(panel.getAttribute("data-preset")).toBe("active");
  });

  it("switches to the working preset when the agent is streaming", async () => {
    function ToggleWorking() {
      const ball = useAgentBall();
      return (
        <button
          type="button"
          data-testid="set-working"
          onClick={() => {
            ball.openWithPrompt("");
            ball.setWorking(true);
          }}
        >
          set working
        </button>
      );
    }
    render(
      <AgentBallProvider>
        <AgentBall userId="u1" />
        <ToggleWorking />
      </AgentBallProvider>,
    );
    fireEvent.click(screen.getByTestId("set-working"));
    const panel = await waitFor(() => screen.getByTestId("agent-panel"));
    expect(panel.getAttribute("data-preset")).toBe("working");
    expect(screen.getByTestId("agent-matrix-working")).toBeTruthy();
  });

  it("opens on click", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
  });

  it("POSTs to /api/agent/threads on open to create a fresh thread", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(countThreadCreatePosts()).toBe(1));
  });

  it("closes on X click", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Close agent"));
    await waitFor(() =>
      expect(screen.queryByTestId("agent-panel")).toBeNull(),
    );
  });

  it("closes on Escape", async () => {
    renderBall();
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
    renderBall();
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
    renderBall();
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: " ", code: "Space" });
      fireEvent.keyDown(document, { key: " ", code: "Space" });
    });
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
  });

  describe("G10 #37 — draggable agent ball (horizontal, bottom-pinned)", () => {
    afterEach(() => {
      window.localStorage.clear();
    });

    it("restores ball position from localStorage on mount", () => {
      window.localStorage.setItem("agent-ball-x", "200");
      renderBall();
      const ball = screen.getByTestId("agent-ball");
      expect(ball.style.left).toBe("200px");
      // when offset is applied, default centering classes are removed
      expect(ball.className).not.toContain("left-1/2");
      expect(ball.className).not.toContain("-translate-x-1/2");
    });

    it("updates position style on pointer drag and persists to localStorage", () => {
      renderBall();
      const ball = screen.getByTestId("agent-ball");
      // initial: no offset
      expect(ball.style.left).toBe("");

      fireEvent.pointerDown(ball, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(ball, { clientX: 350, pointerId: 1 });
      fireEvent.pointerUp(ball, { clientX: 350, pointerId: 1 });

      expect(ball.style.left).toMatch(/^\d+px$/);
      expect(window.localStorage.getItem("agent-ball-x")).not.toBeNull();
    });
  });

  describe("G10 #37 — draggable agent panel", () => {
    afterEach(() => {
      window.localStorage.clear();
    });

    it("restores panel position from localStorage on open", async () => {
      window.localStorage.setItem("agent-convo-x", "150");
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));
      expect(panel.style.left).toBe("150px");
    });
  });

  describe("G10 #39 — collapsible & fullscreen agent convo", () => {
    it("hides body when collapse button clicked, restores on click again", async () => {
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));
      // Body present initially
      expect(panel.querySelector('[data-testid="agent-panel-body"]')).toBeTruthy();
      const collapseBtn = screen.getByLabelText(/collapse agent/i);
      fireEvent.click(collapseBtn);
      expect(panel.getAttribute("data-collapsed")).toBe("true");
      // Click again to restore
      const expandBtn = screen.getByLabelText(/expand agent/i);
      fireEvent.click(expandBtn);
      expect(panel.getAttribute("data-collapsed")).toBe("false");
    });

    it("retains AgentTranscript state across collapse/expand (body hidden, not unmounted)", async () => {
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));
      // Wait for the transcript stub to mount once threadId arrives.
      const input = (await waitFor(() =>
        screen.getByTestId("agent-draft-input"),
      )) as HTMLInputElement;
      // Type a draft message.
      fireEvent.change(input, { target: { value: "hello world" } });
      expect(input.value).toBe("hello world");

      // Collapse — body wrapper should gain `hidden` class but stay mounted.
      fireEvent.click(screen.getByLabelText(/collapse agent/i));
      const body = panel.querySelector(
        '[data-testid="agent-panel-body"]',
      ) as HTMLElement;
      expect(body).toBeTruthy();
      expect(body.className).toContain("hidden");
      // Transcript stub still in DOM (not unmounted).
      expect(screen.getByTestId("agent-transcript-stub")).toBeTruthy();

      // Expand — draft text must be preserved (proves state survived).
      fireEvent.click(screen.getByLabelText(/expand agent/i));
      const inputAfter = screen.getByTestId(
        "agent-draft-input",
      ) as HTMLInputElement;
      expect(inputAfter.value).toBe("hello world");
      expect(body.className).not.toContain("hidden");
    });

    it("applies inset-0 when fullscreen toggled, restores on second click", async () => {
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));
      expect(panel.className).not.toContain("inset-0");
      fireEvent.click(screen.getByLabelText(/fullscreen agent/i));
      expect(panel.className).toContain("inset-0");
      fireEvent.click(screen.getByLabelText(/exit fullscreen/i));
      expect(panel.className).not.toContain("inset-0");
    });
  });
});
