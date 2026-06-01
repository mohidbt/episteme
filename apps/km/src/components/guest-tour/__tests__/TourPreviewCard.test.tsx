// @vitest-environment jsdom
import type * as React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import { TourPreviewCard } from "../TourPreviewCard";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />;
  },
}));

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  stubMatchMedia(false);
});

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

  it("renders <video> (not <img>) when mediaSrc ends in .webm", () => {
    const { container } = render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaSrc="/tour/wow_refs_fill.webm"
        mediaAlt="ref fill demo"
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("/tour/wow_refs_fill.webm");
    // No <img> should render for the media (no alt match)
    expect(screen.queryByAltText("ref fill demo")).toBeNull();
  });

  it("video has aria-label equal to mediaAlt", () => {
    const { container } = render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaSrc="/tour/wow_refs_fill.webm"
        mediaAlt="ref fill demo"
      />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("aria-label")).toBe("ref fill demo");
  });

  it("passes mediaPoster to <video poster> when autoplay active", () => {
    const { container } = render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaSrc="/tour/wow_refs_fill.webm"
        mediaPoster="/tour/wow_refs_fill.jpg"
        mediaAlt="ref fill demo"
      />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("poster")).toBe("/tour/wow_refs_fill.jpg");
  });

  it("renders <img src={mediaPoster}> instead of <video> when reduced-motion ON", () => {
    stubMatchMedia(true);
    const { container } = render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaSrc="/tour/wow_refs_fill.webm"
        mediaPoster="/tour/wow_refs_fill.jpg"
        mediaAlt="ref fill demo"
      />,
    );
    expect(container.querySelector("video")).toBeNull();
    const img = screen.getByAltText("ref fill demo") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/tour/wow_refs_fill.jpg");
  });

  it("renders <Image> (img) when mediaSrc is SVG (existing behavior)", () => {
    render(
      <TourPreviewCard
        title="t"
        caption="c"
        mediaSrc="/tour/graph_intro.svg"
        mediaAlt="graph"
      />,
    );
    const img = screen.getByAltText("graph") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("/tour/graph_intro.svg");
  });
});
