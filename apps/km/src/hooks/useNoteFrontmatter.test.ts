// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNoteFrontmatter } from "./useNoteFrontmatter";

describe("useNoteFrontmatter", () => {
  it("hands the editor the body and re-attaches the rows on save", () => {
    const md = "---\nstatus: draft\n---\nHello";
    const { result } = renderHook(() => useNoteFrontmatter(md));
    expect(result.current.body.trim()).toBe("Hello");
    const saved = result.current.transformMd("Hello again");
    expect(saved).toContain("status: draft");
    expect(saved).toContain("Hello again");
  });

  it("passes markdown without frontmatter through unchanged", () => {
    const { result } = renderHook(() => useNoteFrontmatter("Plain"));
    expect(result.current.body).toBe("Plain");
    expect(result.current.transformMd("Plain text")).toBe("Plain text");
  });
});
