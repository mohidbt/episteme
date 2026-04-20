import Placeholder from "@tiptap/extension-placeholder";
import { createExtensions as baseExtensions } from "@episteme/markdown";

export function editorExtensions(opts?: { placeholder?: string }) {
  return [
    ...baseExtensions(),
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Start writing…" }),
  ];
}
