import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions } from "@episteme/markdown";
import { invokeAgent } from "./AgentCommand";
import type { JSONContent } from "@tiptap/core";

function makeEditor() {
  return new Editor({
    extensions: createExtensions(),
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    },
  });
}

describe("invokeAgent", () => {
  it("is callable without throwing", () => {
    const editor = makeEditor();
    expect(() => invokeAgent(editor, { skill: "triage" })).not.toThrow();
    editor.destroy();
  });

  it("does not modify the document (stub no-op)", () => {
    const editor = makeEditor();
    const before: JSONContent = JSON.parse(JSON.stringify(editor.getJSON()));
    invokeAgent(editor, { skill: "triage" });
    const after: JSONContent = editor.getJSON();
    editor.destroy();
    expect(after).toEqual(before);
  });

  it("logs a console.info with the skill name", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const editor = makeEditor();
    invokeAgent(editor, { skill: "summarize" });
    editor.destroy();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("summarize"),
      expect.anything(),
    );
    infoSpy.mockRestore();
  });
});
