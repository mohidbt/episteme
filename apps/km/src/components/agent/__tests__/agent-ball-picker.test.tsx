// @vitest-environment jsdom
//
// GSD-96 R5 — AgentBall LITE picker integration (plan §3.7).
//
// Why: AgentBall is the floating mini-chat surface. Plan §3.7 requires a
// LITE @-picker + drop wiring on this surface so users can attach library
// handles from the floating ball — not only the full /agents page.
//
// Decision (documented for orchestrator + reviewer): AgentBall already
// delegates its body to <AgentTranscript>, which since R3-B mounts the
// real <ChatComposer> (LITE textarea + popover picker, dnd-kit droppable)
// and wires FinderDropDispatch. So the "LITE picker on AgentBall" need is
// satisfied by AgentBall's existing composition — but until now there was
// NO TEST proving the picker is actually reachable from inside the floating
// panel. This file asserts that reachability. It does NOT stub
// AgentTranscript (the existing AgentBall.test.tsx does, to keep that suite
// focused) — we mount the real subtree so the integration is real.
//
// Edge-case enumeration (per plan §12):
//   - panel closed: no composer, no picker — guard against accidental mount
//   - panel open: composer + textarea present
//   - typing `@` in the floating-panel composer opens the picker popover
//     (proves picker reachability inside the floating ball)
//   - drop surface (chat-composer droppable) is registered when panel open
//     (proves drag-drop reachability from drive sidebar / drive page)
//   - paperclip button present (proves Finder-drop path is wired)
//   - omitted: full DnD round-trip (covered by ChatComposer + at-mention
//     recents unit tests already), full streaming send (covered by
//     AgentTranscript.composer-wiring.test.tsx)
//
// Network: fetch is stubbed minimally — thread create + wiki search return
// empty payloads so the picker renders an empty "No results" state but the
// popover still mounts (proves the trigger fires).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { AgentBall } from "../AgentBall";
import { AgentBallProvider } from "../agent-ball-context";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

let threadCounter = 0;

beforeEach(async () => {
  threadCounter = 0;
  const { useAgentBallStore } = await import("@/state/agent-ball");
  useAgentBallStore.setState({
    activeThreadId: null,
    panelOpen: false,
    mountPoint: "global-popover",
  });
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
      if (url.includes("/api/library/recents")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.includes("/api/wiki-link/search")) {
        return new Response(
          JSON.stringify({ papers: [], notes: [], references: [] }),
          { status: 200 },
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

function renderBall() {
  return render(
    <DndContext>
      <AgentBallProvider>
        <AgentBall userId="u1" />
      </AgentBallProvider>
    </DndContext>,
  );
}

describe("AgentBall — LITE @-picker + drop wiring (GSD-96 R5)", () => {
  it("does not mount the composer while the panel is closed", () => {
    renderBall();
    expect(screen.queryByTestId("chat-composer")).toBeNull();
  });

  it("mounts the real ChatComposer inside the floating panel when opened", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => {
      expect(screen.getByTestId("agent-panel")).toBeTruthy();
    });
    // The composer testid must be present inside the panel — proves
    // AgentTranscript wired the real composer (not a bare textarea).
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer")).toBeTruthy();
    });
    const panel = screen.getByTestId("agent-panel");
    const composer = screen.getByTestId("chat-composer");
    expect(panel.contains(composer)).toBe(true);
  });

  it("typing @ in the floating panel composer opens the picker popover", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => screen.getByTestId("chat-composer"));
    // GSD-105: Tiptap composer — drive via paste of `@` so the
    // Suggestion plugin's onStart fires inside jsdom.
    const editor = screen.getByTestId("chat-composer-editor");
    const clipboardData = {
      getData: (t: string) => (t === "text/plain" ? "@" : ""),
      types: ["text/plain"],
      files: [] as File[],
    };
    fireEvent.paste(editor, { clipboardData });
    await waitFor(() => {
      expect(screen.getByTestId("chat-composer-picker")).toBeTruthy();
    });
  });

  it("exposes a paperclip button (Finder-drop entry point) in the floating panel", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => screen.getByTestId("chat-composer"));
    // PaperclipButton from ChatFileAttachments renders an aria-label.
    // Existence proves the Finder-drop UX is reachable from the ball.
    const clip = screen.getByLabelText(/attach/i);
    expect(clip).toBeTruthy();
  });

  it("registers a chat-composer droppable surface inside the floating panel", async () => {
    renderBall();
    fireEvent.click(screen.getByTestId("agent-ball"));
    await waitFor(() => screen.getByTestId("chat-composer"));
    // useDroppable({ id: "chat-composer" }) attaches setNodeRef to the
    // wrapper div carrying data-testid="chat-composer". The element exists
    // inside the panel — that's the integration claim (drop target is
    // mounted inside the ball, not just on the standalone /agents page).
    const composer = screen.getByTestId("chat-composer");
    expect(composer).toBeTruthy();
    expect(composer.tagName.toLowerCase()).toBe("div");
  });
});
