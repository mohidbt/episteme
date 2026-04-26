import { describe, expect, it } from "vitest";
import { mdToProseMirror, proseMirrorToMd, unescapeLegacyMd } from "../index.js";

/**
 * Round-trip stability test: after unescaping legacy MD, a parse→serialize
 * cycle must produce the same string (no re-escaping).
 *
 * If this test fails it means tiptap-markdown's serializer is still escaping
 * plain text characters, and we need to tighten the plain-text escaping rules.
 */
describe("unescapeLegacyMd round-trip stability", () => {
  it("legacy ordered list with bold does not re-escape after round-trip", () => {
    const legacy = "1\\. \\*\\*foo\\*\\* bar";
    const unescaped = unescapeLegacyMd(legacy);
    expect(unescaped).toBe("1. **foo** bar");

    const doc = mdToProseMirror(unescaped);
    const back = proseMirrorToMd(doc);
    expect(back).toBe(unescaped);
  });

  it("legacy italic with underscore does not re-escape", () => {
    const legacy = "\\_italic\\_";
    const unescaped = unescapeLegacyMd(legacy);
    expect(unescaped).toBe("_italic_");

    const doc = mdToProseMirror(unescaped);
    const back = proseMirrorToMd(doc);
    expect(back).toContain("_italic_");
  });

  it("legacy paragraph with mixed bold/italic/plain does not re-escape", () => {
    const legacy = "Plain text \\*\\*bold\\*\\* and \\*\\*more bold\\*\\* end.";
    const unescaped = unescapeLegacyMd(legacy);
    expect(unescaped).toBe("Plain text **bold** and **more bold** end.");

    const doc = mdToProseMirror(unescaped);
    const back = proseMirrorToMd(doc);
    expect(back).toBe(unescaped);
  });

  it("plain text with no legacy escapes round-trips unchanged", () => {
    const md = "Just plain text with no markdown.\n";
    const doc = mdToProseMirror(md);
    const back = proseMirrorToMd(doc);
    expect(back.trim()).toBe(md.trim());
  });
});
