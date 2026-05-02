"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseDragXOptions {
  /** localStorage key under which to persist the x offset (px). */
  storageKey: string;
  /** When set, clamp computed x to [0, window.innerWidth - elementWidth]. */
  elementWidth?: number;
  /** When set with axis='xy', clamp y to [0, window.innerHeight - elementHeight]. */
  elementHeight?: number;
  /** "x" (default, legacy) or "xy" — also tracks vertical. */
  axis?: "x" | "xy";
  /**
   * On pointer release, snap y. "bottom" pins y to viewport bottom
   * (gravity). Only meaningful when axis === "xy".
   */
  snapY?: "bottom" | "none";
}

/** Movement threshold (px) beyond which pointerDown+pointerUp counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;

/**
 * Drag hook. Persists the x offset to localStorage; y is transient (not
 * persisted) and — when `snapY === "bottom"` — snaps to the viewport floor on
 * release (G-R3-05 #83 gravity).
 */
export function useDragX({
  storageKey,
  elementWidth,
  elementHeight,
  axis = "x",
  snapY = "none",
}: UseDragXOptions) {
  const [x, setX] = useState<number | null>(null);

  // Read from localStorage after mount so first render matches server (no hydration mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage?.getItem(storageKey);
      if (raw == null) return;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) setX(n);
    } catch {
      // private mode or quota
    }
  }, [storageKey]);
  const [y, setY] = useState<number | null>(null);

  const draggingRef = useRef(false);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  /** Tracks whether the pointer moved beyond the drag threshold this gesture. */
  const didMoveRef = useRef(false);
  const startClientXRef = useRef(0);
  const startClientYRef = useRef(0);

  const clampX = useCallback(
    (next: number) => {
      if (typeof window === "undefined") return next;
      const max = Math.max(0, window.innerWidth - (elementWidth ?? 0));
      if (next < 0) return 0;
      if (next > max) return max;
      return next;
    },
    [elementWidth],
  );

  const clampY = useCallback(
    (next: number) => {
      if (typeof window === "undefined") return next;
      const max = Math.max(0, window.innerHeight - (elementHeight ?? 0));
      if (next < 0) return 0;
      if (next > max) return max;
      return next;
    },
    [elementHeight],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // RG3 #56 — bail when pointerdown originates on an interactive descendant
    // OTHER than the drag handle itself. Without the currentTarget check, a
    // <button>-style drag handle (like the matrix ball) bailed because
    // closest("button") returns the handle itself.
    const target = e.target as Element | null;
    if (target && target !== e.currentTarget) {
      const interactive = target.closest?.(
        "button,a,input,textarea,select,[role='button']",
      );
      if (interactive && interactive !== e.currentTarget) return;
    }
    draggingRef.current = true;
    didMoveRef.current = false;
    startClientXRef.current = e.clientX;
    startClientYRef.current = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();
    offsetXRef.current = e.clientX - rect.left;
    offsetYRef.current = e.clientY - rect.top;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      // Check if the pointer has moved beyond the drag threshold.
      const dx = e.clientX - startClientXRef.current;
      const dy = e.clientY - startClientYRef.current;
      if (!didMoveRef.current && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        didMoveRef.current = true;
      }
      setX(clampX(e.clientX - offsetXRef.current));
      if (axis === "xy") {
        setY(clampY(e.clientY - offsetYRef.current));
      }
    },
    [axis, clampX, clampY],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setX((curr) => {
        if (curr !== null) {
          try {
            window.localStorage.setItem(storageKey, String(curr));
          } catch {
            /* ignore quota / private mode */
          }
        }
        return curr;
      });
      if (axis === "xy" && snapY === "bottom") {
        if (typeof window !== "undefined") {
          setY(Math.max(0, window.innerHeight - (elementHeight ?? 0)));
        }
      }
    },
    [axis, elementHeight, snapY, storageKey],
  );

  // Re-clamp on viewport resize so the element doesn't sit off-screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setX((curr) => (curr === null ? curr : clampX(curr)));
      setY((curr) => {
        if (curr === null) return curr;
        if (snapY === "bottom") {
          return Math.max(0, window.innerHeight - (elementHeight ?? 0));
        }
        return clampY(curr);
      });
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [clampX, clampY, elementHeight, snapY]);

  return {
    x,
    y,
    /** Ref that is `true` when the current pointer gesture moved beyond the drag threshold. */
    didMoveRef,
    pointerHandlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
