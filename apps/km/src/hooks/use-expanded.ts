"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_NS = "km.sidebar.expand.v1";

function readAll(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_NS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function useExpanded(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState<boolean>(initial);

  useEffect(() => {
    const persisted = readAll()[key];
    if (typeof persisted === "boolean" && persisted !== initial) setOpen(persisted);
  }, [key, initial]);

  const set = useCallback(
    (v: boolean) => {
      setOpen(v);
      if (typeof window === "undefined") return;
      const obj = readAll();
      obj[key] = v;
      window.localStorage.setItem(STORAGE_NS, JSON.stringify(obj));
    },
    [key],
  );

  return [open, set];
}
