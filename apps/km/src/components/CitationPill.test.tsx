// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CitationPill } from "./CitationPill";

afterEach(() => cleanup());

describe("CitationPill", () => {
  it("builds paper href with page and hl", () => {
    render(
      <CitationPill
        source={{
          sourceKind: "paper",
          sourceId: "paper-1",
          page: 4,
          highlight: "12,20,44,66",
          title: "Paper A",
        }}
      />
    );
    const link = screen.getByRole("link", { name: /open paper citation/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/p/paper-1?p=4&hl=12%2C20%2C44%2C66");
    expect(link.getAttribute("title")).toBe("Paper A");
  });

  it("builds note href with heading anchor", () => {
    render(
      <CitationPill
        source={{
          sourceKind: "note",
          sourceId: "n-1",
          slug: "my-note",
          heading: "Related Work",
          title: "Note A",
        }}
      />
    );
    const link = screen.getByRole("link", { name: /open note citation/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/n/my-note#Related%20Work");
  });

  it("handles missing note metadata", () => {
    render(
      <CitationPill
        source={{
          sourceKind: "note",
          sourceId: "fallback-slug",
        }}
      />
    );
    const link = screen.getByRole("link", { name: /open note citation/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/n/fallback-slug");
    expect(link.getAttribute("title")).toBe("Note");
  });
});
