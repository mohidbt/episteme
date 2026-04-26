import { describe, expect, it } from "vitest";
import { unescapeLegacyMd } from "../unescape-legacy-md.js";

describe("unescapeLegacyMd", () => {
  it("strips backslash before asterisk", () => {
    expect(unescapeLegacyMd("\\*bold\\*")).toBe("*bold*");
  });

  it("strips backslash before underscore", () => {
    expect(unescapeLegacyMd("\\_italic\\_")).toBe("_italic_");
  });

  it("strips backslash before dot (ordered list escape)", () => {
    expect(unescapeLegacyMd("1\\. item")).toBe("1. item");
  });

  it("strips backslash before bracket characters", () => {
    expect(unescapeLegacyMd("\\[link\\]\\(url\\)")).toBe("[link](url)");
  });

  it("strips backslash before hash, plus, dash, gt, pipe, tilde, backtick, bang", () => {
    expect(unescapeLegacyMd("\\# \\+ \\- \\> \\| \\~ \\` \\!")).toBe(
      "# + - > | ~ ` !",
    );
  });

  it("preserves double backslash (escaped backslash)", () => {
    expect(unescapeLegacyMd("path\\\\to\\\\file")).toBe("path\\\\to\\\\file");
  });

  it("handles the canonical legacy MD sample from the bug report", () => {
    expect(
      unescapeLegacyMd("1\\. \\*\\*Self-Attention Mechanism\\*\\* : rest"),
    ).toBe("1. **Self-Attention Mechanism** : rest");
  });

  it("is idempotent: applying twice yields the same result", () => {
    const input = "1\\. \\*\\*foo\\*\\* bar";
    const once = unescapeLegacyMd(input);
    const twice = unescapeLegacyMd(once);
    expect(twice).toBe(once);
  });

  it("preserves content inside inline code spans unchanged", () => {
    const input = "`1\\. \\*\\*inside code\\*\\*`";
    expect(unescapeLegacyMd(input)).toBe("`1\\. \\*\\*inside code\\*\\*`");
  });

  it("preserves content inside fenced code blocks unchanged", () => {
    const input = "```\n1\\. \\*\\*inside fence\\*\\*\n```";
    expect(unescapeLegacyMd(input)).toBe(
      "```\n1\\. \\*\\*inside fence\\*\\*\n```",
    );
  });

  it("processes text outside code spans but not inside", () => {
    const input = "\\*outside\\* and `\\*inside\\*`";
    expect(unescapeLegacyMd(input)).toBe("*outside* and `\\*inside\\*`");
  });

  it("handles empty string", () => {
    expect(unescapeLegacyMd("")).toBe("");
  });

  it("leaves text with no escapes unchanged", () => {
    const input = "plain text with **bold** and _italic_";
    expect(unescapeLegacyMd(input)).toBe(input);
  });
});
