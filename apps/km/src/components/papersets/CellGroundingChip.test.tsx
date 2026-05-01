// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const routerMock = { push: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { CellGroundingChip } from "./CellGroundingChip";

beforeEach(() => {
  routerMock.push.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("CellGroundingChip", () => {
  it("renders chip with block ref in aria-label and short text", () => {
    render(
      <CellGroundingChip paperId="p-1" blockIds={["p-1:7", "p-1:8"]} />,
    );
    const chip = screen.getByTestId("cell-grounding-chip");
    expect(chip.getAttribute("aria-label")).toContain("p-1:7");
    expect(chip.textContent).toBe("#7");
  });

  it("clicking chip pushes /p/<paperId>?block=<first_block_id>", () => {
    render(
      <CellGroundingChip paperId="p-abc" blockIds={["p-abc:42"]} />,
    );
    fireEvent.click(screen.getByTestId("cell-grounding-chip"));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith(
      "/p/p-abc?block=p-abc%3A42",
    );
  });

  it("does not render when blockIds is empty (n/a or empty cell)", () => {
    const { container } = render(
      <CellGroundingChip paperId="p-1" blockIds={[]} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("cell-grounding-chip")).toBeNull();
  });

  it("uses provided label override", () => {
    render(
      <CellGroundingChip
        paperId="p-1"
        blockIds={["p-1:7"]}
        label="p.5"
      />,
    );
    expect(screen.getByTestId("cell-grounding-chip").textContent).toBe("p.5");
  });

  it("stops propagation so the cell underneath doesn't receive the click", () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <CellGroundingChip paperId="p-1" blockIds={["p-1:7"]} />
      </div>,
    );
    fireEvent.click(screen.getByTestId("cell-grounding-chip"));
    expect(onParentClick).not.toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});
