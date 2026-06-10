/**
 * GSD-84 — Editor key isolation.
 *
 * The editor's contenteditable surface must not let plain-letter keystrokes
 * bubble out to window/document-level listeners, or global single-key hotkeys
 * (real or future) would hijack the user's typing. Modifier-bearing combos
 * (Cmd/Ctrl/Alt) and Escape/Tab still propagate so app shortcuts and focus
 * traversal keep working.
 */

export function shouldStopEditorKeyPropagation(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "Escape" || e.key === "Tab") return false;
  return true;
}

export function attachEditorKeyIsolation(host: HTMLElement): () => void {
  const handler = (e: Event) => {
    if (!(e instanceof KeyboardEvent)) return;
    if (shouldStopEditorKeyPropagation(e)) {
      e.stopPropagation();
    }
  };
  host.addEventListener("keydown", handler);
  return () => host.removeEventListener("keydown", handler);
}
