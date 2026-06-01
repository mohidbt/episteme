// @vitest-environment jsdom
import type * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import { TourPreviewCard } from "../TourPreviewCard";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />;
  },
}));

describe("TourPreviewCard", () => {
  it("renders title, caption, and media", () => {
    render(
      <TourPreviewCard
        title="Graph"
        caption="Lines = set connections."
        mediaSrc="/tour/graph_intro.svg"
        mediaAlt="graph illustration"
      />,
    );
    expect(screen.getByText("Graph")).toBeDefined();
    expect(screen.getByText("Lines = set connections.")).toBeDefined();
    expect(screen.getByAltText("graph illustration")).toBeDefined();
  });

  it("shows preview badge by default", () => {
    render(
      <TourPreviewCard title="t" caption="c" mediaAlt="alt" />,
    );
    expect(screen.getByTestId("tour-preview-badge")).toBeDefined();
  });

  it("hides preview badge when previewBadge=false", () => {
    render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaAlt="alt"
        previewBadge={false}
      />,
    );
    expect(screen.queryByTestId("tour-preview-badge")).toBeNull();
  });
});
