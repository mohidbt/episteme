// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import { mdToProseMirror } from "@episteme/markdown";
import { yjsToMd } from "../src/yjs-to-md.js";

/**
 * Seed a Y.Doc from markdown by:
 *  1. mdToProseMirror → ProseMirror JSON
 *  2. prosemirrorJSONToYDoc(schema, json) → Y.Doc
 *
 * We use a minimal Tiptap editor to obtain the schema.
 */
function mdToYDoc(md: string): Y.Doc {
  const { Editor } = require("@tiptap/core");
  const { createExtensions } = require("@episteme/markdown");
  const pmJson = mdToProseMirror(md);
  const editor = new Editor({ extensions: createExtensions() });
  const schema = editor.schema;
  editor.destroy();
  return prosemirrorJSONToYDoc(schema, pmJson);
}

describe("yjsToMd", () => {
  it("plain paragraph round-trips to 'hello'", () => {
    const doc = mdToYDoc("hello");
    const md = yjsToMd(doc);
    expect(md.trim()).toBe("hello");
  });

  it("heading + paragraph round-trip", () => {
    const input = "# Title\n\nBody\n";
    const doc = mdToYDoc(input);
    const md = yjsToMd(doc);
    // Normalize: trim trailing whitespace on each line, compare paragraphs
    const norm = (s: string) =>
      s.trim().split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ")).join("\n\n");
    expect(norm(md)).toBe(norm(input));
  });

  it("bullet list round-trip", () => {
    const input = "- a\n- b\n- c\n";
    const doc = mdToYDoc(input);
    const md = yjsToMd(doc);
    const norm = (s: string) =>
      s.trim().split(/\n+/).map((l) => l.trim()).join("\n");
    expect(norm(md)).toBe(norm(input));
  });

  it("wiki-link survives round-trip", () => {
    const input = "See [[Some Note]] here.";
    const doc = mdToYDoc(input);
    const md = yjsToMd(doc);
    expect(md).toContain("[[Some Note]]");
  });
});
