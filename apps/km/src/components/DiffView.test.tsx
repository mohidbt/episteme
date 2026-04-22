// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DiffView } from "./DiffView";

afterEach(cleanup);

describe("DiffView", () => {
  it("renders identical strings with no added/removed spans", () => {
    const { container } = render(<DiffView prev="hello world" next="hello world" />);
    expect(container.querySelector("[data-diff='added']")).toBeNull();
    expect(container.querySelector("[data-diff='removed']")).toBeNull();
    expect(container.textContent).toContain("hello world");
  });

  it("renders an added span for pure addition", () => {
    const { container } = render(<DiffView prev="hello" next="hello world" />);
    const added = container.querySelector("[data-diff='added']");
    expect(added).not.toBeNull();
    expect(added?.textContent).toContain("world");
    expect(container.querySelector("[data-diff='removed']")).toBeNull();
  });

  it("renders a removed span for pure deletion", () => {
    const { container } = render(<DiffView prev="hello world" next="hello" />);
    const removed = container.querySelector("[data-diff='removed']");
    expect(removed).not.toBeNull();
    expect(removed?.textContent).toContain("world");
    expect(container.querySelector("[data-diff='added']")).toBeNull();
  });

  it("renders both added and removed spans for mixed edits", () => {
    const { container } = render(
      <DiffView prev="the quick brown fox" next="the slow brown dog" />,
    );
    const added = container.querySelectorAll("[data-diff='added']");
    const removed = container.querySelectorAll("[data-diff='removed']");
    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);
    const addedText = Array.from(added).map((n) => n.textContent).join(" ");
    const removedText = Array.from(removed).map((n) => n.textContent).join(" ");
    expect(addedText).toContain("slow");
    expect(addedText).toContain("dog");
    expect(removedText).toContain("quick");
    expect(removedText).toContain("fox");
  });
});
