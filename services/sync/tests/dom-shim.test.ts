// NOTE: deliberately runs in vitest's default node environment (no jsdom).
// The shim itself must install `document` / `window` so Tiptap's Editor
// constructor doesn't throw in the production server process.
import { describe, expect, it } from "vitest";
import "../src/dom-shim.js";
import { Editor } from "@tiptap/core";
import { createExtensions } from "@episteme/markdown";

describe("dom-shim", () => {
  it("installs window and document on the global scope", () => {
    expect(typeof globalThis.document).toBe("object");
    expect(typeof globalThis.window).toBe("object");
  });

  it("lets Tiptap Editor construct in a Node process without ReferenceError", () => {
    const editor = new Editor({ extensions: createExtensions() });
    try {
      expect(editor.schema).toBeDefined();
    } finally {
      editor.destroy();
    }
  });
});
