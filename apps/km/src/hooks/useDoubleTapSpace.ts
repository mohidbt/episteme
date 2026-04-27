"use client";

import { useEffect, useRef } from "react";

const DOUBLE_TAP_WINDOW_MS = 350;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Detects two presses of Space within DOUBLE_TAP_WINDOW_MS anywhere in the
 * document (not in inputs/textareas/contenteditables) and invokes `onTap`.
 */
export function useDoubleTapSpace(onTap: () => void, enabled = true): void {
  const cbRef = useRef(onTap);
  cbRef.current = onTap;

  useEffect(() => {
    if (!enabled) return;
    let lastAt = 0;

    function handler(e: KeyboardEvent) {
      if (e.key !== " " && e.code !== "Space") return;
      if (isEditableTarget(e.target)) return;
      if (e.repeat) return;
      const now = Date.now();
      if (now - lastAt <= DOUBLE_TAP_WINDOW_MS) {
        lastAt = 0;
        e.preventDefault();
        cbRef.current();
        return;
      }
      lastAt = now;
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled]);
}
