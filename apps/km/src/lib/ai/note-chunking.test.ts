import { describe, it, expect } from "vitest";
import { chunkMarkdown, CHUNK_CHAR_CAP } from "./note-chunking";

describe("chunkMarkdown", () => {
  it("empty string returns []", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  it("whitespace-only returns []", () => {
    expect(chunkMarkdown("   \n\n  ")).toEqual([]);
  });

  it("single short paragraph returns one chunk", () => {
    expect(chunkMarkdown("hello world")).toEqual([
      { chunkIdx: 0, content: "hello world" },
    ]);
  });

  it("heading and body in one chunk when small", () => {
    const out = chunkMarkdown("# Title\n\nbody paragraph.");
    expect(out).toHaveLength(1);
    expect(out[0].chunkIdx).toBe(0);
    expect(out[0].content).toBe("# Title\n\nbody paragraph.");
  });

  it("5000-char doc yields 2+ chunks each <= 2500", () => {
    const para = "word ".repeat(100).trim();
    const input = "# Topic\n\n" + Array.from({ length: 10 }, () => para).join("\n\n");
    const out = chunkMarkdown(input);
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const c of out) {
      expect(c.content.length).toBeLessThanOrEqual(CHUNK_CHAR_CAP);
    }
    out.forEach((c, i) => {
      expect(c.chunkIdx).toBe(i);
    });
  });

  it("single giant paragraph >2500 chars is emitted as one chunk (by design: no word-level splitting in P0)", () => {
    const input = "x".repeat(5000);
    const out = chunkMarkdown(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.length).toBe(5000);
    expect(out[0].chunkIdx).toBe(0);
  });

  it("paragraph split uses \\n{2,}", () => {
    const out = chunkMarkdown("a\n\nb\n\n\nc");
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("a\n\nb\n\nc");
  });

  it("chunkIdx is monotonic from 0", () => {
    const big = "para ".repeat(400);
    const input = [big, big, big, big].join("\n\n");
    const out = chunkMarkdown(input);
    expect(out.length).toBeGreaterThan(1);
    out.forEach((c, i) => {
      expect(c.chunkIdx).toBe(i);
    });
  });
});
