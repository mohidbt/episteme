/**
 * B7 — citation-click target resolution.
 *
 * Bug being fixed: AgentTranscript.handleCitationClick navigated to
 * `/p/{paperId}?...` (the public viewer) on every click, including clicks
 * fired from inside the reader. That unmounts the reader, kills the chat
 * panel, and breaks the read-with-agent flow. Inside the reader the click
 * must scroll in-place; outside the reader it must route to the reader URL
 * (NOT the public viewer).
 */
import { describe, expect, it } from "vitest";
import { resolveCitationTarget, isReaderPath } from "./citation-target";

describe("isReaderPath", () => {
  it("matches /papers/[id]/read", () => {
    expect(isReaderPath("/papers/abc/read")).toBe(true);
    expect(isReaderPath("/papers/abc-uuid/read?p=4")).toBe(true);
    expect(isReaderPath("/papers/abc/read/")).toBe(true);
  });

  it("does not match adjacent paths", () => {
    expect(isReaderPath("/papers/abc")).toBe(false);
    expect(isReaderPath("/p/abc")).toBe(false);
    expect(isReaderPath("/papers/abc/edit")).toBe(false);
    expect(isReaderPath(null)).toBe(false);
    expect(isReaderPath(undefined)).toBe(false);
  });
});

describe("resolveCitationTarget", () => {
  it("returns in-place target when invoked from inside the reader", () => {
    const t = resolveCitationTarget({
      pathname: "/papers/abc/read",
      paperId: "abc",
      page: 4,
      bbox: "1,2,3,4",
    });
    expect(t).toEqual({
      kind: "in-place",
      paperId: "abc",
      page: 4,
      bbox: "1,2,3,4",
    });
  });

  it("returns navigate target to the reader (NOT /p/) when invoked outside it", () => {
    const t = resolveCitationTarget({
      pathname: "/drive",
      paperId: "abc",
      page: 4,
      bbox: "1,2,3,4",
    });
    expect(t.kind).toBe("navigate");
    if (t.kind === "navigate") {
      expect(t.url).toBe(`/papers/abc/read?p=4&hl=${encodeURIComponent("1,2,3,4")}`);
      // Defensive: must not collapse to the public viewer URL.
      expect(t.url.startsWith("/p/")).toBe(false);
    }
  });

  it("omits hl query when bbox is null", () => {
    const t = resolveCitationTarget({
      pathname: "/drive",
      paperId: "abc",
      page: 2,
      bbox: null,
    });
    expect(t.kind).toBe("navigate");
    if (t.kind === "navigate") {
      expect(t.url).toBe("/papers/abc/read?p=2");
    }
  });

  it("clamps non-positive page to 1", () => {
    const t = resolveCitationTarget({
      pathname: "/drive",
      paperId: "abc",
      page: 0,
      bbox: null,
    });
    if (t.kind === "navigate") {
      expect(t.url).toBe("/papers/abc/read?p=1");
    }
  });
});
