import { describe, expect, it } from "vitest";
import {
  buildMarkdownWithFrontmatter,
  inferType,
  parseFrontmatter,
  parseFrontmatterRows,
  serializeFrontmatterRows,
  splitFrontmatter,
} from "../frontmatter.js";

describe("splitFrontmatter", () => {
  it("returns null raw when source has no fences", () => {
    const { raw, body } = splitFrontmatter("Just a body.\n");
    expect(raw).toBeNull();
    expect(body).toBe("Just a body.\n");
  });

  it("splits a simple frontmatter block", () => {
    const src = "---\nauthor: Foo\n---\nbody here\n";
    const { raw, body } = splitFrontmatter(src);
    expect(raw).toBe("author: Foo");
    expect(body).toBe("body here\n");
  });

  it("returns null raw when fence is unterminated", () => {
    const src = "---\nauthor: Foo\nbody never closes\n";
    const { raw } = splitFrontmatter(src);
    expect(raw).toBeNull();
  });
});

describe("parseFrontmatterRows", () => {
  it("parses string scalar", () => {
    const rows = parseFrontmatterRows("author: Foo");
    expect(rows).toEqual([{ key: "author", value: "Foo", type: "text" }]);
  });

  it("parses bracketed array as tags", () => {
    const rows = parseFrontmatterRows("tags: [a, b, c]");
    expect(rows).toEqual([
      { key: "tags", value: ["a", "b", "c"], type: "tags" },
    ]);
  });

  it("strips quotes from string values", () => {
    const rows = parseFrontmatterRows(`title: "Hello: World"`);
    expect(rows[0].value).toBe("Hello: World");
  });

  it("ignores blank lines and lines without a colon", () => {
    const rows = parseFrontmatterRows("\nauthor: Foo\n# not a row\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("author");
  });
});

describe("inferType", () => {
  it("ISO date string -> date", () => {
    expect(inferType("2026-04-28")).toBe("date");
  });
  it("number -> number", () => {
    expect(inferType(42)).toBe("number");
  });
  it("array -> tags", () => {
    expect(inferType(["x", "y"])).toBe("tags");
  });
  it("plain text -> text", () => {
    expect(inferType("hello world")).toBe("text");
  });
});

describe("parseFrontmatterRows numeric inference", () => {
  it("treats `42` as number", () => {
    const rows = parseFrontmatterRows("count: 42");
    expect(rows[0].value).toBe(42);
    expect(rows[0].type).toBe("number");
  });

  it("treats ISO date as date type", () => {
    const rows = parseFrontmatterRows("created: 2026-04-28");
    expect(rows[0].value).toBe("2026-04-28");
    expect(rows[0].type).toBe("date");
  });
});

describe("parseFrontmatter end-to-end", () => {
  it("parses fenced block + body together", () => {
    const src = "---\nauthor: Foo\ntags: [a, b]\n---\n# Body\n\nhi\n";
    const { rows, body } = parseFrontmatter(src);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ key: "author", value: "Foo", type: "text" });
    expect(rows[1]).toEqual({
      key: "tags",
      value: ["a", "b"],
      type: "tags",
    });
    expect(body).toBe("# Body\n\nhi\n");
  });

  it("returns empty rows + original body when no frontmatter", () => {
    const src = "# Just a body\n";
    const { rows, body } = parseFrontmatter(src);
    expect(rows).toEqual([]);
    expect(body).toBe(src);
  });
});

describe("serializeFrontmatterRows + buildMarkdownWithFrontmatter", () => {
  it("serializes a string row", () => {
    const out = serializeFrontmatterRows([
      { key: "author", value: "Foo", type: "text" },
    ]);
    expect(out).toBe("author: Foo");
  });

  it("serializes array as bracket literal", () => {
    const out = serializeFrontmatterRows([
      { key: "tags", value: ["a", "b"], type: "tags" },
    ]);
    expect(out).toBe("tags: [a, b]");
  });

  it("quotes values containing colons", () => {
    const out = serializeFrontmatterRows([
      { key: "title", value: "Hello: World", type: "text" },
    ]);
    expect(out).toBe(`title: "Hello: World"`);
  });

  it("buildMarkdownWithFrontmatter returns body as-is when no rows", () => {
    expect(buildMarkdownWithFrontmatter([], "# body\n")).toBe("# body\n");
  });

  it("buildMarkdownWithFrontmatter wraps rows in fences", () => {
    const md = buildMarkdownWithFrontmatter(
      [{ key: "author", value: "Foo", type: "text" }],
      "# body\n",
    );
    expect(md).toBe("---\nauthor: Foo\n---\n# body\n");
  });
});

describe("frontmatter round-trip", () => {
  it("parse -> serialize -> parse yields the same structure", () => {
    const src =
      "---\nauthor: Foo\ntags: [a, b]\ncount: 7\ncreated: 2026-04-28\n---\nbody\n";
    const { rows, body } = parseFrontmatter(src);
    const rebuilt = buildMarkdownWithFrontmatter(rows, body);
    const second = parseFrontmatter(rebuilt);
    expect(second.rows).toEqual(rows);
    expect(second.body).toBe(body);
  });

  it("mutating a row then re-serializing reflects the change", () => {
    const src = "---\nauthor: Foo\n---\nbody\n";
    const { rows, body } = parseFrontmatter(src);
    rows[0] = { ...rows[0], value: "Bar" };
    const rebuilt = buildMarkdownWithFrontmatter(rows, body);
    expect(rebuilt).toBe("---\nauthor: Bar\n---\nbody\n");
  });
});
