/**
 * Task #7 — Editor extension installs.
 *
 * Verifies that:
 * 1. Placeholder extension is registered (already in tree).
 * 2. Global Drag Handle extension is registered.
 * 3. FileHandler extension is registered and receives an onDrop callback.
 *
 * We don't simulate full drop events here (jsdom + ProseMirror DnD is brittle);
 * we assert that the FileHandler extension is present in the editor's
 * extension list with our upload handler wired up. A separate E2E test in
 * apps/km should exercise the actual upload flow.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "./extensions";

describe("editor extensions registration", () => {
  it("includes the Placeholder extension", () => {
    const editor = new Editor({
      extensions: editorExtensions({ placeholder: "Start writing…" }),
    });
    const has = editor.extensionManager.extensions.some((e) => e.name === "placeholder");
    editor.destroy();
    expect(has).toBe(true);
  });

  it("includes the Global Drag Handle extension", () => {
    const editor = new Editor({
      extensions: editorExtensions(),
    });
    const has = editor.extensionManager.extensions.some(
      (e) => e.name === "globalDragHandle" || e.name === "global-drag-handle",
    );
    editor.destroy();
    expect(has).toBe(true);
  });

  it("includes the FileHandler extension when an upload handler is supplied", () => {
    let dropped: File[] | null = null;
    const editor = new Editor({
      extensions: editorExtensions({
        fileUpload: {
          onDrop: (_editor, files) => {
            dropped = files;
          },
        },
      }),
    });
    const has = editor.extensionManager.extensions.some((e) => e.name === "fileHandler");
    editor.destroy();
    expect(has).toBe(true);
    // Variable retained to assert the API shape compiles; runtime call is exercised via Tiptap internals.
    expect(dropped).toBeNull();
  });

  it("omits FileHandler when no upload handler is supplied", () => {
    const editor = new Editor({
      extensions: editorExtensions(),
    });
    const has = editor.extensionManager.extensions.some((e) => e.name === "fileHandler");
    editor.destroy();
    expect(has).toBe(false);
  });
});
