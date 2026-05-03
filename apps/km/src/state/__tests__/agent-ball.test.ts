import { describe, it, expect } from "vitest";
import { useAgentBallStore } from "../agent-ball";

describe("agent-ball store", () => {
  it("starts closed with no thread", () => {
    const s = useAgentBallStore.getState();
    expect(s.panelOpen).toBe(false);
    expect(s.activeThreadId).toBeNull();
    expect(s.mountPoint).toBe("global-popover");
  });

  it("openInReader sets mount point to reader-side-panel and opens panel", () => {
    useAgentBallStore.getState().openInReader();
    const s = useAgentBallStore.getState();
    expect(s.mountPoint).toBe("reader-side-panel");
    expect(s.panelOpen).toBe(true);
  });

  it("openInGlobalPopover restores popover mount point", () => {
    useAgentBallStore.getState().openInGlobalPopover();
    const s = useAgentBallStore.getState();
    expect(s.mountPoint).toBe("global-popover");
    expect(s.panelOpen).toBe(true);
  });

  it("setActiveThread updates id without changing open state", () => {
    useAgentBallStore.getState().close();
    useAgentBallStore.getState().setActiveThread("t1");
    const s = useAgentBallStore.getState();
    expect(s.activeThreadId).toBe("t1");
    expect(s.panelOpen).toBe(false);
  });

  it("close resets mountPoint to global-popover so leaving reader does not strand state", () => {
    useAgentBallStore.getState().openInReader();
    expect(useAgentBallStore.getState().mountPoint).toBe("reader-side-panel");
    useAgentBallStore.getState().close();
    const s = useAgentBallStore.getState();
    expect(s.panelOpen).toBe(false);
    expect(s.mountPoint).toBe("global-popover");
  });
});
