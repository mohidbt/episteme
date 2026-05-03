import { create } from "zustand";

type MountPoint = "global-popover" | "reader-side-panel";

type AgentBallState = {
  activeThreadId: string | null;
  panelOpen: boolean;
  mountPoint: MountPoint;

  setActiveThread: (id: string | null) => void;
  openInGlobalPopover: () => void;
  openInReader: () => void;
  close: () => void;
  toggle: (mountPoint?: MountPoint) => void;
};

export const useAgentBallStore = create<AgentBallState>((set) => ({
  activeThreadId: null,
  panelOpen: false,
  mountPoint: "global-popover",

  setActiveThread: (id) => set({ activeThreadId: id }),
  openInGlobalPopover: () => set({ panelOpen: true, mountPoint: "global-popover" }),
  openInReader: () => set({ panelOpen: true, mountPoint: "reader-side-panel" }),
  close: () => set({ panelOpen: false, mountPoint: "global-popover" }),
  toggle: (mountPoint) =>
    set((s) => ({
      panelOpen: !s.panelOpen,
      ...(mountPoint ? { mountPoint } : {}),
    })),
}));
