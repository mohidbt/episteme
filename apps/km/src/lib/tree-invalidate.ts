"use client";

import { useEffect } from "react";

const EVENT_NAME = "episteme:tree-invalidated";

export function invalidateTree(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function useTreeInvalidation(callback: () => void): void {
  useEffect(() => {
    function onInvalidate() {
      callback();
    }
    window.addEventListener(EVENT_NAME, onInvalidate);
    return () => window.removeEventListener(EVENT_NAME, onInvalidate);
  }, [callback]);
}
