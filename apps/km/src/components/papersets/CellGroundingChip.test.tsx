// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const routerMock = { push: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import {
  CellGroundingChip,
  blockRefPageNumber,
  blockRefSegmentIndex,
} from "./CellGroundingChip";

beforeEach(() => {
  routerMock.push.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("blockRefPageNumber", () => {
  it("extracts page number from _p<num>_ pattern", () => {
    expect(blockRefPageNumber("block_abc123_p5_0")).toBe(5);
    expect(blockRefPageNumber("block_uuid_p12_idx")).toBe(12);
  });

  it("returns null when no _p<num>_ pattern exists", () => {
    expect(blockRefPageNumber("seg_ABC_nonpage")).toBeNull();
    expect(blockRefPageNumber("p-1:7")).toBeNull();
  });

  it("returns null for zero or negative page numbers", () => {
    expect(blockRefPageNumber("block_x_p0_0")).toBeNull();
  });

  it("never returns #XX format — always numeric or null", () => {
    // This tests that #XX format is gone (see #104)
    const result = blockRefPageNumber("block_x_p105_0");
    expect(result).toBe(105);
    expect(typeof result).toBe("number");
  });

  it("parses new read_paper format `<paper>:p<n>:<order>`", () => {
    expect(blockRefPageNumber("uuid-abc:p7:42")).toBe(7);
  });
});

describe("blockRefSegmentIndex", () => {
  it("extracts trailing order_index from legacy `<paper>:<n>` format", () => {
    expect(blockRefSegmentIndex("paper-uuid:42")).toBe(42);
    expect(blockRefSegmentIndex("p-1:0")).toBe(0);
  });

  it("returns null when block ID already carries a page anchor", () => {
    expect(blockRefSegmentIndex("uuid:p5:12")).toBeNull();
    expect(blockRefSegmentIndex("block_abc_p5_0")).toBeNull();
  });

  it("returns null for block IDs with no parseable segment index", () => {
    expect(blockRefSegmentIndex("seg_ABC_nonpage")).toBeNull();
    expect(blockRefSegmentIndex("paper-uuid:")).toBeNull();
  });
});

describe("CellGroundingChip", () => {
  it("renders chip with p.XX label when block ID has a page anchor", () => {
    render(
      <CellGroundingChip
        paperId="p-1"
        blockIds={["block_abc_p7_0", "block_abc_p7_1"]}
      />,
    );
    const chip = screen.getByTestId("cell-grounding-chip");
    expect(chip.getAttribute("aria-label")).toContain("page 7");
    expect(chip.textContent).toBe("p.7");
  });

  it("renders a Link to /papers/<paperId>/read?p=<page> for BG2a deeplink (BG2b)", () => {
    render(
      <CellGroundingChip
        paperId="p-abc"
        blockIds={["block_abc_p4_0"]}
      />,
    );
    const chip = screen.getByTestId("cell-grounding-chip");
    // The chip should be (or be wrapped in) an anchor with the BG2a href.
    const anchor = chip.tagName === "A" ? chip : chip.closest("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("/papers/p-abc/read?p=4");
  });

  it("does not render when blockIds is empty (n/a or empty cell)", () => {
    const { container } = render(
      <CellGroundingChip paperId="p-1" blockIds={[]} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("cell-grounding-chip")).toBeNull();
  });

  it("does not render when block ID has no page anchor and no parseable segment", () => {
    // Block ID without _p<num>_ AND without a trailing :<n> segment → hidden
    const { container } = render(
      <CellGroundingChip paperId="p-1" blockIds={["seg_ABC_nonpage"]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides chip for legacy `<paper>:<order>` block IDs without page anchor (#155)", () => {
    // Pre-R5 read_paper produced `<paper_id>:<order_index>` (no page).
    // Surfacing it as #105 / §105 confused users on small PDFs — hide instead.
    const { container } = render(
      <CellGroundingChip paperId="p-1" blockIds={["paper-uuid:105"]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("prefers p.<n> over §<n> when both could apply via maxPage filter", () => {
    // page exceeds maxPage → fall through to segment fallback if present.
    // Here new-format block has both page and order; segment helper sees
    // the :pN: anchor and returns null, so chip hides.
    const { container } = render(
      <CellGroundingChip
        paperId="p-1"
        blockIds={["uuid:p999:5"]}
        maxPage={15}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("uses provided label override when label is a string", () => {
    render(
      <CellGroundingChip
        paperId="p-1"
        blockIds={["block_abc_p7_0"]}
        label="p.5"
      />,
    );
    expect(screen.getByTestId("cell-grounding-chip").textContent).toBe("p.5");
  });

  it("hides chip when label is explicitly null", () => {
    const { container } = render(
      <CellGroundingChip
        paperId="p-1"
        blockIds={["block_abc_p7_0"]}
        label={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides chip when page number exceeds maxPage", () => {
    const { container } = render(
      <CellGroundingChip
        paperId="p-1"
        blockIds={["block_abc_p105_0"]}
        maxPage={15}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows chip when page number is within maxPage", () => {
    render(
      <CellGroundingChip
        paperId="p-1"
        blockIds={["block_abc_p5_0"]}
        maxPage={15}
      />,
    );
    expect(screen.getByTestId("cell-grounding-chip").textContent).toBe("p.5");
  });

  it("stops propagation so the cell underneath doesn't receive the click", () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <CellGroundingChip
          paperId="p-1"
          blockIds={["block_abc_p7_0"]}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId("cell-grounding-chip"));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});