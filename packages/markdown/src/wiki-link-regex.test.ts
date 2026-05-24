import { describe, expect, it } from "vitest";
import { extractLinks, extractTags } from "./wiki-link-regex";

describe("extractLinks", () => {
  it("extracts a bare note link", () => {
    expect(extractLinks("see [[Transformers]]")).toEqual([
      { kind: "note", raw: "Transformers", alias: null },
    ]);
  });

  it("extracts a note link with alias", () => {
    expect(extractLinks("see [[Transformers|TF]]")).toEqual([
      { kind: "note", raw: "Transformers", alias: "TF" },
    ]);
  });

  it("classifies @-prefixed inner as reference kind and strips @", () => {
    expect(extractLinks("[[@vaswani2017]]")).toEqual([
      { kind: "reference", raw: "vaswani2017", alias: null },
    ]);
  });

  it("extracts reference with alias", () => {
    expect(extractLinks("[[@vaswani2017|V17]]")).toEqual([
      { kind: "reference", raw: "vaswani2017", alias: "V17" },
    ]);
  });

  it("classifies pdf:-prefixed inner as paper kind", () => {
    expect(extractLinks("[[pdf:crispr-paper.pdf]]")).toEqual([
      { kind: "paper", raw: "crispr-paper.pdf", alias: null },
    ]);
  });

  it("pdf prefix is case-insensitive", () => {
    expect(extractLinks("[[PDF:file.pdf]]")).toEqual([
      { kind: "paper", raw: "file.pdf", alias: null },
    ]);
  });

  it("classifies p:-prefixed inner as paper kind and strips p:", () => {
    expect(extractLinks("[[p:crispr-paper.pdf]]")).toEqual([
      { kind: "paper", raw: "crispr-paper.pdf", alias: null },
    ]);
  });

  it("classifies r:-prefixed inner as reference kind and strips r:", () => {
    expect(extractLinks("[[r:vaswani2017]]")).toEqual([
      { kind: "reference", raw: "vaswani2017", alias: null },
    ]);
  });

  it("p: prefix supports alias", () => {
    expect(extractLinks("[[p:foo.pdf|Foo]]")).toEqual([
      { kind: "paper", raw: "foo.pdf", alias: "Foo" },
    ]);
  });

  it("r: prefix supports alias", () => {
    expect(extractLinks("[[r:vaswani2017|V17]]")).toEqual([
      { kind: "reference", raw: "vaswani2017", alias: "V17" },
    ]);
  });

  it("ignores backslash-escaped link opener", () => {
    expect(extractLinks("not a link: \\[[Escaped]]")).toEqual([]);
  });

  it("ignores links inside fenced code blocks", () => {
    expect(extractLinks("```\n[[NotALink]]\n```")).toEqual([]);
  });

  it("ignores links inside inline code", () => {
    expect(extractLinks("inline `[[NotALink]]` here")).toEqual([]);
  });

  it("dedupes identical links (same kind+raw+alias)", () => {
    expect(extractLinks("[[A]] and [[A]]")).toEqual([
      { kind: "note", raw: "A", alias: null },
    ]);
  });

  it("keeps links distinct when alias differs", () => {
    expect(extractLinks("[[A]] and [[A|x]]")).toEqual([
      { kind: "note", raw: "A", alias: null },
      { kind: "note", raw: "A", alias: "x" },
    ]);
  });

  it("rejects nested brackets inside link target", () => {
    expect(extractLinks("[[Note with [brackets]]]")).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(extractLinks("")).toEqual([]);
  });

  it("trims whitespace inside link target", () => {
    expect(extractLinks("[[   Title   ]]")).toEqual([
      { kind: "note", raw: "Title", alias: null },
    ]);
  });
});

describe("extractTags", () => {
  it("extracts tags with hyphens and underscores", () => {
    expect(extractTags("hello #ml and #deep-learning and #deep_rl")).toEqual([
      "ml",
      "deep-learning",
      "deep_rl",
    ]);
  });

  it("ignores hash preceded by letter/digit (e.g. issue#123)", () => {
    expect(extractTags("issue#123 is not a tag")).toEqual([]);
  });

  it("ignores content inside code fences", () => {
    expect(extractTags("```\n# heading in code\n```")).toEqual([]);
  });

  it("ignores markdown heading hashes", () => {
    expect(extractTags("# Heading\n## Sub")).toEqual([]);
  });

  it("does not extract backslash-escaped hash", () => {
    expect(extractTags("\\#escaped and #real")).toEqual(["real"]);
  });

  it("dedupes repeated tags", () => {
    expect(extractTags("#ml and #ml again")).toEqual(["ml"]);
  });

  it("normalizes to lowercase and dedupes case-insensitively", () => {
    expect(extractTags("#ML and #ml")).toEqual(["ml"]);
  });

  it("rejects tags that start with a digit", () => {
    expect(extractTags("#123")).toEqual([]);
  });

  it("does not include trailing punctuation in tag", () => {
    expect(extractTags("#foo.")).toEqual(["foo"]);
  });

  it("treats newlines as preceding whitespace", () => {
    expect(extractTags("Tags at eol: #a\n#b")).toEqual(["a", "b"]);
  });
});
