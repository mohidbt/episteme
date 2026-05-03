import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FindBar } from "../find-bar";

afterEach(() => cleanup());

describe("FindBar", () => {
  it("calls onSearch on input change", () => {
    const onSearch = vi.fn();
    render(
      <FindBar
        open
        onSearch={onSearch}
        onNext={() => {}}
        onPrev={() => {}}
        onClose={() => {}}
        onToggleCase={() => {}}
        matchCase={false}
      />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "loss" } });
    expect(onSearch).toHaveBeenCalledWith("loss", { matchCase: false });
  });

  it("Esc calls onClose", () => {
    const onClose = vi.fn();
    render(
      <FindBar
        open
        onSearch={() => {}}
        onNext={() => {}}
        onPrev={() => {}}
        onClose={onClose}
        onToggleCase={() => {}}
        matchCase={false}
      />
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
