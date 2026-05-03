"use client";
import { useEffect, useState, useCallback } from "react";

export type Dock = "right" | "bottom" | "left";

const STORAGE_PREFIX = "dockable-sidebar";

/**
 * Read/write hook for the persisted dock position of a sidebar id.
 *
 * The actual layout (PanelGroup placement + per-panel sizes) lives in
 * `reader-client.tsx`. This hook only stores the user's docking preference,
 * which `reader-client.tsx` reads to decide which slot to render the
 * sidebar into (left, right, or bottom).
 */
export function useSidebarDock(id: string, defaultDock: Dock = "right") {
  const storageKey = `${STORAGE_PREFIX}:${id}:dock`;
  const [dock, setDock] = useState<Dock>(defaultDock);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(storageKey);
    if (v === "right" || v === "left" || v === "bottom") setDock(v);
  }, [storageKey]);

  const setAndPersist = useCallback(
    (next: Dock) => {
      setDock(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, next);
      }
    },
    [storageKey]
  );

  return [dock, setAndPersist] as const;
}

interface DockMenuProps {
  dock: Dock;
  onChange: (next: Dock) => void;
  onClose?: () => void;
}

/**
 * Inline dock control rendered inside a sidebar's own header.
 *
 * Consumers pass this (or compose it themselves) via the `dockControl`
 * prop on each sidebar so the trigger lives in normal flow — no more
 * absolute positioning that overlaps the title.
 */
export function DockMenu({ dock, onChange, onClose }: DockMenuProps) {
  return (
    <div className="inline-flex items-center gap-0.5">
      <details className="relative">
      <summary
        className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Dock position"
        data-testid="dock-menu-trigger"
      >
        <span aria-hidden="true">⋮</span>
      </summary>
      <div
        role="menu"
        className="absolute right-0 top-full z-20 mt-1 w-28 rounded-md border bg-popover p-1 shadow"
      >
        {(["right", "bottom", "left"] as Dock[]).map((d) => (
          <button
            key={d}
            type="button"
            role="menuitem"
            data-testid={`dock-menu-item-${d}`}
            className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-accent ${
              dock === d ? "font-semibold" : ""
            }`}
            onClick={(e) => {
              // Close <details> before re-render so the menu doesn't linger
              const det = (e.currentTarget.closest("details") as HTMLDetailsElement | null);
              if (det) det.open = false;
              onChange(d);
            }}
          >
            {d}
          </button>
        ))}
      </div>
      </details>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-testid="sidebar-close"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}
