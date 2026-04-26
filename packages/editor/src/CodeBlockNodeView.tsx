"use client";

import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

// Languages registered in packages/markdown/src/extensions.ts. Keep in sync
// with the lowlight.register() calls there — labels are the canonical fence
// names, values are the keys lowlight knows.
const LANGUAGES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "TypeScript", value: "ts" },
  { label: "TSX", value: "tsx" },
  { label: "JavaScript", value: "js" },
  { label: "Python", value: "python" },
  { label: "Rust", value: "rust" },
  { label: "Go", value: "go" },
  { label: "Bash", value: "bash" },
  { label: "JSON", value: "json" },
  { label: "Markdown", value: "markdown" },
  { label: "SQL", value: "sql" },
  { label: "YAML", value: "yaml" },
];

/**
 * Notion-style language switcher rendered inside each fenced code block.
 * The select sits absolutely-positioned in the top-right corner and only
 * appears on hover (or when focused) so it doesn't compete with the prose.
 */
export function CodeBlockNodeView({ node, updateAttributes }: NodeViewProps) {
  const lang = ((node.attrs.language as string | null) ?? "").toLowerCase();
  return (
    <NodeViewWrapper as="div" className="episteme-code-block">
      <select
        contentEditable={false}
        value={lang}
        onChange={(e) => {
          const v = e.target.value;
          updateAttributes({ language: v === "" ? null : v });
        }}
        // Stop ProseMirror from intercepting key events while the dropdown
        // has focus — otherwise arrow keys move the editor selection, not
        // the option list.
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="episteme-code-block__lang"
        aria-label="Code language"
      >
        <option value="">plain</option>
        {LANGUAGES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
