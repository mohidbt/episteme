"use client";

import { useEffect, useRef } from "react";

/**
 * Single, shared "the drive/sidebar tree changed" signal.
 *
 * Every mutation that affects what shows in the Drive sidebar (move, upload,
 * rename, trash, restore, new-folder, new-note, etc.) calls
 * `invalidateDriveTree()` after the API write resolves. The sidebar subscribes
 * via `useDriveSync()` and reacts (typically `router.refresh()` + a key bump).
 *
 * Keep this file minimal. Adding per-feature event types would re-introduce
 * the discipline gap this file fixes.
 */

const EVENT_NAME = "episteme:drive-tree-invalidated";

export function invalidateDriveTree(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function useDriveSync(callback: () => void): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    function handler() {
      ref.current();
    }
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);
}
