"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

/**
 * Wraps the table node with a drag handle (shown on wrapper hover).
 * NodeViewContent renders as <table> to preserve Tiptap schema/CSS expectations.
 * GripVertical is inlined as SVG to avoid adding lucide-react to editor deps.
 */
export function TableNodeView(_props: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="episteme-table-wrapper">
      <div
        className="episteme-table-drag-handle"
        data-drag-handle
        contentEditable={false}
      >
        {/* GripVertical icon (lucide) — 16×16 */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="9" cy="5" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="9" cy="19" r="1" />
          <circle cx="15" cy="5" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="15" cy="19" r="1" />
        </svg>
      </div>
      <NodeViewContent as="table" />
    </NodeViewWrapper>
  );
}
