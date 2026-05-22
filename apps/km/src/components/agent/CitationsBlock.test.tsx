// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { InlineCitationPills } from "./CitationsBlock";
import type { Citation } from "@/lib/agent-events";

afterEach(() => {
  cleanup();
});

describe("CitationsBlock — InlineCitationPills (G6.2)", () => {
  const citation: Citation = {
    chunk_id: "paper-1:p4:7",
    paper_id: "paper-1",
    title: "Attention Is All You Need - Page 4",
    page: 4,
    snippet: "Scaled dot-product attention computes the function on a set of queries.",
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    score: 0.91,
  };

  it("fires onCitationClick when the pill is clicked (G6.2 click)", () => {
    const onClick = vi.fn();
    render(
      <InlineCitationPills citations={[citation]} onCitationClick={onClick} />,
    );
    const pill = screen.getByTestId(
      `inline-citation-pill-${citation.chunk_id}`,
    );
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(citation);
  });

  it("reveals a hover body containing the citation title on pointer hover (G6.2 hover)", async () => {
    render(
      <InlineCitationPills
        citations={[citation]}
        onCitationClick={() => {}}
      />,
    );
    const pill = screen.getByTestId(
      `inline-citation-pill-${citation.chunk_id}`,
    );
    // Base UI PreviewCard opens on pointer hover with mousemove/pointermove.
    fireEvent.pointerEnter(pill, { pointerType: "mouse" });
    fireEvent.pointerMove(pill, { pointerType: "mouse" });
    fireEvent.mouseEnter(pill);

    await waitFor(
      () => {
        // Title rendered inside the hover-card-content body
        expect(screen.getByText(citation.title!)).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });
});
