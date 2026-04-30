"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseDragXOptions {
  /** localStorage key under which to persist the x offset (px). */
  storageKey: string;
  /** When set, clamp computed x to [0, window.innerWidth - elementWidth]. */
  elementWidth?: number;
}

/**
 * Horizontal-only drag hook. Persists the resulting x offset (px from
 * viewport left) to localStorage so it restores across reloads.
 *
 * Returns:
 *  - `x`: current pixel offset from left, or `null` while no offset has been
 *    set (caller falls back to default centering).
 *  - `pointerHandlers`: spread onto the draggable element.
 */
export function useDragX({ storageKey, elementWidth }: UseDragXOptions) {
  const [x, setX] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage?.getItem(storageKey);
      if (raw == null) return null;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });

  const draggingRef = useRef(false);
  const offsetRef = useRef(0); // pointer offset within the element

  const clamp = useCallback(
    (next: number) => {
      if (typeof window === "undefined") return next;
      const max = Math.max(0, window.innerWidth - (elementWidth ?? 0));
      if (next < 0) return 0;
      if (next > max) return max;
      return next;
    },
    [elementWidth],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    draggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    offsetRef.current = e.clientX - rect.left;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      const next = clamp(e.clientX - offsetRef.current);
      setX(next);
    },
    [clamp],
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
    },
    [storageKey],
  );

  // Re-clamp on viewport resize so the element doesn't sit off-screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setX((curr) => (curr === null ? curr : clamp(curr)));
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [clamp]);

  return {
    x,
    pointerHandlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
