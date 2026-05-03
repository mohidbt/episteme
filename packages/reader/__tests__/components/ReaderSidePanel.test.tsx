import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReaderSidePanel } from "../../src/components/ReaderSidePanel";

describe("ReaderSidePanel", () => {
  afterEach(cleanup);


  it("renders nothing when closed", () => {
    const { container } = render(
      <ReaderSidePanel isOpen={false} onClose={() => {}}>
        <div>transcript</div>
      </ReaderSidePanel>
    );
    expect(container.querySelector("[data-reader-side-panel]")).toBeNull();
  });

  it("renders provided transcript when open", () => {
    render(
      <ReaderSidePanel isOpen onClose={() => {}}>
        <div>injected transcript</div>
      </ReaderSidePanel>
    );
    expect(screen.getByText("injected transcript")).toBeTruthy();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(
      <ReaderSidePanel isOpen onClose={onClose}>
        <div>x</div>
      </ReaderSidePanel>
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
