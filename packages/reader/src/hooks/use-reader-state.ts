import { create } from "zustand";

interface ReaderState {
  currentPage: number;
  totalPages: number;
  scrollTargetPage: number | null;
  zoom: number;
  toolbarCollapsed: boolean;
  setCurrentPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  setScrollTargetPage: (page: number | null) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setToolbarCollapsed: (v: boolean) => void;
}

function readToolbarCollapsed(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage?.getItem("toolbarCollapsed") === "1"
    );
  } catch {
    return false;
  }
}

export const useReaderState = create<ReaderState>((set) => ({
  currentPage: 1,
  totalPages: 0,
  scrollTargetPage: null,
  zoom: 1.0,
  toolbarCollapsed: readToolbarCollapsed(),
  setCurrentPage: (page) =>
    set((s) => ({
      currentPage: Math.max(1, Math.min(s.totalPages || 1, page)),
    })),
  setTotalPages: (total) => set({ totalPages: total }),
  setScrollTargetPage: (page) =>
    set((s) => {
      if (page === null) return { scrollTargetPage: null };
      const clamped = Math.max(1, Math.min(s.totalPages || 1, page));
      return { scrollTargetPage: clamped, currentPage: clamped };
    }),
  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(3.0, zoom)) }),
  zoomIn: () => set((s) => ({ zoom: Math.min(3.0, s.zoom + 0.25) })),
  zoomOut: () => set((s) => ({ zoom: Math.max(0.5, s.zoom - 0.25) })),
  resetZoom: () => set({ zoom: 1.0 }),
  setToolbarCollapsed: (v) => {
    set({ toolbarCollapsed: v });
    try {
      if (typeof window !== "undefined") {
        window.localStorage?.setItem("toolbarCollapsed", v ? "1" : "0");
      }
    } catch {
      // ignore (e.g. test env without localStorage)
    }
  },
}));
