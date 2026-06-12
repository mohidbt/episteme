"use client";

// GSD-96 Round 2 — root-level DndContext for the authed (app) tree.
//
// Per plan section 3.3 we hoist a single DndContext to the (app) layout so
// the chat-composer droppable (Round 3) can accept drags from drive sidebar
// AND drive page AND any future surface in one provider.
//
// Round 2 scope: provider mounts; no top-level onDragEnd handlers. Existing
// nested contexts (DriveTree, FileBrowser) keep their own onDragEnd for
// folder-move semantics. The outer provider exists as the registration point
// for cross-surface droppables shipping in Round 3.
//
// Mount guard: dnd-kit generates incremental aria-describedby IDs that
// diverge between SSR + client. Only attach DndContext post-hydration to
// avoid mismatch (same pattern as DriveTree.tsx).

import { useEffect, useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

interface Props {
  children: ReactNode;
}

export function AppDndContext({ children }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  if (!mounted) return <>{children}</>;

  return <DndContext sensors={sensors}>{children}</DndContext>;
}
