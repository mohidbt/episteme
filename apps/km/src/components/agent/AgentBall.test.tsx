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

  it("RG1 #59 — renders Matrix standalone (no circular wrapper) with drop-shadow", () => {
    renderBall();
    const ball = screen.getByTestId("agent-ball");
    const cls = ball.className;
    expect(cls).not.toContain("rounded-full");
    expect(cls).not.toMatch(/\bbg-background\b/);
    expect(cls).not.toMatch(/\bbackdrop-blur/);
    expect(cls).toContain("drop-shadow-md");
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

  it("#111 — double-tap Space fires same toggle as clicking the matrix square", async () => {
    renderBall();
    expect(screen.queryByTestId("agent-panel")).toBeNull();

    // Double-space should open (same as clicking the ball)
    await act(async () => {
      fireEvent.keyDown(document, { key: " ", code: "Space" });
      fireEvent.keyDown(document, { key: " ", code: "Space" });
    });
    await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());

    // Double-space again should close (toggle behavior, same as clicking the ball)
    await act(async () => {
      fireEvent.keyDown(document, { key: " ", code: "Space" });
      fireEvent.keyDown(document, { key: " ", code: "Space" });
    });
    await waitFor(() =>
      expect(screen.queryByTestId("agent-panel")).toBeNull(),
    );
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

    it("#90 — pointerdown starts drag and pointermove moves the element", () => {
      renderBall();
      const ball = screen.getByTestId("agent-ball");
      expect(ball.style.left).toBe("");

      // Simulate drag: pointerdown, then pointermove by a significant distance
      fireEvent.pointerDown(ball, { clientX: 200, clientY: 760, pointerId: 1 });
      fireEvent.pointerMove(ball, { clientX: 400, clientY: 760, pointerId: 1 });
      fireEvent.pointerUp(ball, { clientX: 400, clientY: 760, pointerId: 1 });

      // The ball should have moved — left should now be set
      expect(ball.style.left).toMatch(/^\d+px$/);
      const left = parseInt(ball.style.left, 10);
      expect(left).toBeGreaterThan(100);
    });

    it("#90 — click (no movement) opens the panel, drag (with movement) does NOT open", async () => {
      renderBall();
      const ball = screen.getByTestId("agent-ball");

      // A short click with no movement should open the panel
      fireEvent.pointerDown(ball, { clientX: 200, clientY: 760, pointerId: 1 });
      fireEvent.pointerUp(ball, { clientX: 200, clientY: 760, pointerId: 1 });
      fireEvent.click(ball);
      await waitFor(() => expect(screen.getByTestId("agent-panel")).toBeTruthy());
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

  describe("G-R3-05 #83 — ball drags vertically and snaps to bottom on release", () => {
    afterEach(() => {
      window.localStorage.clear();
    });

    it("snaps y to viewport bottom on pointer up (gravity)", () => {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 800,
      });
      renderBall();
      const ball = screen.getByTestId("agent-ball");
      // Ball is 7 cells * (4+2) - 2 = 40px wide/tall (size=4, gap=2, rows=cols=7)
      fireEvent.pointerDown(ball, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(ball, { clientX: 250, clientY: 200, pointerId: 1 });
      fireEvent.pointerUp(ball, { clientX: 250, clientY: 200, pointerId: 1 });
      // After release, top style should equal innerHeight - ballHeight (40 → 760).
      expect(ball.style.top).toMatch(/^\d+px$/);
      const top = parseInt(ball.style.top, 10);
      expect(top).toBeGreaterThan(700);
    });

    it("persists x to localStorage but not y", () => {
      renderBall();
      const ball = screen.getByTestId("agent-ball");
      fireEvent.pointerDown(ball, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(ball, { clientX: 280, clientY: 220, pointerId: 1 });
      fireEvent.pointerUp(ball, { clientX: 280, clientY: 220, pointerId: 1 });
      expect(window.localStorage.getItem("agent-ball-x")).not.toBeNull();
      expect(window.localStorage.getItem("agent-ball-y")).toBeNull();
    });
  });

  describe("#91 — NO hover behavior on the matrix square", () => {
    it("hovering does NOT change position (no parallax translate)", () => {
      renderBall();
      const ball = screen.getByTestId("agent-ball");
      const transformBefore = ball.style.transform;
      fireEvent.mouseEnter(ball);
      fireEvent.mouseMove(ball, { clientX: 50, clientY: 50 });
      // Transform must remain unchanged — no parallax tilt.
      expect(ball.style.transform).toBe(transformBefore);
    });

    it("no data-hovered attribute and no speedMultiplier on Matrix", () => {
      renderBall();
      const ball = screen.getByTestId("agent-ball");
      // data-hovered should not exist at all.
      expect(ball.hasAttribute("data-hovered")).toBe(false);
      // MatrixBadge should not receive hovered prop (no speed boost).
      const matrix = screen.getByTestId("agent-matrix-inactive");
      // Matrix speedMultiplier defaults to 1; verify no speedMultiplier attr.
      expect(matrix.getAttribute("data-speed-multiplier")).toBeNull();
    });
  });

  describe("G-R3-05 #76 — collapse animates the panel into the matrix square", () => {
    it("when collapsed, panel sets data-shrunk='true' and the transcript stays mounted", async () => {
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));
      const input = (await waitFor(() =>
        screen.getByTestId("agent-draft-input"),
      )) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "draft preserved" } });

      fireEvent.click(screen.getByLabelText(/collapse agent/i));
      // The panel must mark itself shrunk so CSS can run the matrix-square tween.
      expect(panel.getAttribute("data-shrunk")).toBe("true");
      // Transcript still in DOM (state preserved).
      expect(screen.getByTestId("agent-transcript-stub")).toBeTruthy();
      const inputAfter = screen.getByTestId(
        "agent-draft-input",
      ) as HTMLInputElement;
      expect(inputAfter.value).toBe("draft preserved");
    });
  });

  describe("#98 — expanded panel stays within sidebar + tabbar bounds", () => {
    it("max-w uses calc(100vw - var(--sidebar-width)) without extra 1rem padding", async () => {
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));
      const cls = panel.className;
      // max-w must be calc(100vw - var(--sidebar-width)), NOT calc(100vw - var(--sidebar-width) - 1rem)
      expect(cls).toMatch(/max-w-\[calc\(100vw-var\(--sidebar-width\)\)\]/);
      // top must be var(--tabbar-h), NOT a calc with fallback
      expect(cls).toMatch(/top-\[var\(--tabbar-h\)\]/);
    });
  });

  describe("RG3 #56 — drag handle does not swallow header button pointer events", () => {
    it("collapse/fullscreen/close buttons remain clickable when pointerdown on a button (drag must not capture)", async () => {
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));

      const collapseBtn = screen.getByLabelText(/collapse agent/i);
      const fullscreenBtn = screen.getByLabelText(/fullscreen agent/i);
      const closeBtn = screen.getByLabelText(/close agent/i);

      // Simulate the real browser sequence: pointerdown bubbles from button to
      // header. If the drag handler captures the pointer on the header, the
      // subsequent click never reaches the button. We fire pointerdown then
      // click on the button; the click handler MUST run.
      fireEvent.pointerDown(collapseBtn, { clientX: 10, pointerId: 1 });
      fireEvent.pointerUp(collapseBtn, { clientX: 10, pointerId: 1 });
      fireEvent.click(collapseBtn);
      expect(panel.getAttribute("data-collapsed")).toBe("true");

      fireEvent.pointerDown(fullscreenBtn, { clientX: 10, pointerId: 1 });
      fireEvent.pointerUp(fullscreenBtn, { clientX: 10, pointerId: 1 });
      fireEvent.click(fullscreenBtn);
      expect(panel.className).toContain("inset-0");

      fireEvent.pointerDown(closeBtn, { clientX: 10, pointerId: 1 });
      fireEvent.pointerUp(closeBtn, { clientX: 10, pointerId: 1 });
      fireEvent.click(closeBtn);
      await waitFor(() =>
        expect(screen.queryByTestId("agent-panel")).toBeNull(),
      );
    });

    it("does not persist a drag offset when pointerdown originated on a header button", async () => {
      window.localStorage.clear();
      renderBall();
      fireEvent.click(screen.getByTestId("agent-ball"));
      const panel = await waitFor(() => screen.getByTestId("agent-panel"));
      const collapseBtn = screen.getByLabelText(/collapse agent/i);

      // pointerdown on button, then pointermove (would normally drag): no
      // x offset should land on the panel because drag must not start.
      fireEvent.pointerDown(collapseBtn, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(collapseBtn, { clientX: 400, pointerId: 1 });
      fireEvent.pointerUp(collapseBtn, { clientX: 400, pointerId: 1 });

      expect(panel.style.left).toBe("");
      expect(window.localStorage.getItem("agent-convo-x")).toBeNull();
    });
  });
});
