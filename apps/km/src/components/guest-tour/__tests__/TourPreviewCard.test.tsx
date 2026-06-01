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

  it("renders CTA button with href and label when cta prop is set", () => {
    render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaAlt="alt"
        previewBadge={false}
        cta={{ label: "Sign up free", href: "/sign-up" }}
      />,
    );
    const cta = screen.getByTestId("tour-cta-button") as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("/sign-up");
    expect(cta.textContent).toContain("Sign up free");
  });

  it("CTA fires onClick synchronously on click (before any navigation handler returns)", () => {
    // Note: jsdom can't run real navigation, and React 19 delegates onClick at
    // the root, so we can't compare native-listener ordering to React ordering
    // here. The semantic we care about is: by the time the click handler chain
    // completes, our onClick has run synchronously. That guarantees done-flag
    // is set before any subsequent route change.
    let calledSync = false;
    const onClick = vi.fn(() => {
      calledSync = true;
    });
    render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaAlt="alt"
        previewBadge={false}
        cta={{ label: "Go", href: "/sign-up", onClick }}
      />,
    );
    const cta = screen.getByTestId("tour-cta-button") as HTMLAnchorElement;
    // Prevent default so jsdom doesn't try to navigate.
    cta.addEventListener("click", (e) => e.preventDefault(), true);
    cta.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(calledSync).toBe(true);
  });

  it("does NOT render CTA button when cta prop is omitted", () => {
    render(<TourPreviewCard title="t" caption="c" mediaAlt="alt" />);
    expect(screen.queryByTestId("tour-cta-button")).toBeNull();
  });
});
