import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./md-frontmatter";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter into data and strips it from content", () => {
    const raw = '---\ntitle: "X"\n---\n\nbody';
    const { data, content } = parseFrontmatter(raw);
    expect(data.title).toBe("X");
    expect(content).toBe("\nbody");
  });

  it("returns empty data and raw content when no frontmatter", () => {
    const raw = "# heading\n\nbody only";
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toBe(raw);
  });

  it("treats malformed YAML as no frontmatter", () => {
    const raw = "---\n: : : bad yaml\n---\nbody";
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toBe(raw);
  });

  it("surfaces multiple frontmatter keys", () => {
    const raw = '---\ntitle: "X"\nslug: x-1\nfolder_path: "a/"\n---\nbody';
    const { data } = parseFrontmatter(raw);
    expect(data.title).toBe("X");
    expect(data.slug).toBe("x-1");
    expect(data.folder_path).toBe("a/");
  });
});
