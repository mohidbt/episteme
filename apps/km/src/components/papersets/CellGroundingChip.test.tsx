// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const routerMock = { push: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { CellGroundingChip, blockRefPageNumber } from "./CellGroundingChip";

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
    expect(chip.getAttribute("aria-label")).toContain("block_abc_p7_0");
    expect(chip.textContent).toBe("p.7");
  });

  it("clicking chip pushes /p/<paperId>?block=<first_block_id>", () => {
    render(
      <CellGroundingChip
        paperId="p-abc"
        blockIds={["block_abc_p42_0"]}
      />,
    );
    fireEvent.click(screen.getByTestId("cell-grounding-chip"));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith(
      "/p/p-abc?block=block_abc_p42_0",
    );
  });

  it("does not render when blockIds is empty (n/a or empty cell)", () => {
    const { container } = render(
      <CellGroundingChip paperId="p-1" blockIds={[]} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("cell-grounding-chip")).toBeNull();
  });

  it("does not render when block ID has no page anchor pattern", () => {
    // #104: block IDs without _p<num>_ produce no pill
    const { container } = render(
      <CellGroundingChip paperId="p-1" blockIds={["seg_ABC_nonpage"]} />,
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
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});