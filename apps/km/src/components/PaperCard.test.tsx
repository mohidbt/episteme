// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaperCard } from "./PaperCard";

afterEach(() => cleanup());

describe("PaperCard", () => {
  it("renders cover image pointing at /api/papers/:id/cover by default", () => {
    const { container } = render(
      <PaperCard
        id="abc"
        title="Hello"
        filename="hello.pdf"
        authors={["Ada Lovelace"]}
        year={2024}
      />
    );
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("/api/papers/abc/cover");
    expect(screen.queryByTestId("paper-card-cover-placeholder")).toBeNull();
  });

  it("renders a placeholder (no broken img) when the cover image fails to load", () => {
    const { container } = render(
      <PaperCard
        id="abc"
        title="Hello"
        filename="hello.pdf"
        authors={null}
        year={null}
      />
    );
    const img = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    // The <img> is removed and replaced with the placeholder.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("paper-card-cover-placeholder")).toBeTruthy();
  });
});
