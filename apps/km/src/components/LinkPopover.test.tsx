// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { LinkPopover } from "./LinkPopover";

afterEach(() => cleanup());

describe("LinkPopover", () => {
  it("pre-fills display text and url inputs from initial props", () => {
    render(
      <LinkPopover
        open
        initialText="example"
        initialHref="https://example.com"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/display text/i) as HTMLInputElement).value).toBe("example");
    expect((screen.getByLabelText(/url/i) as HTMLInputElement).value).toBe("https://example.com");
  });

  it("calls onSave with edited text + href when Insert is clicked", () => {
    const onSave = vi.fn();
    render(
      <LinkPopover open initialText="" initialHref="" onSave={onSave} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/display text/i), { target: { value: "click me" } });
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "https://foo.com" } });
    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onSave).toHaveBeenCalledWith({ text: "click me", href: "https://foo.com" });
  });

  it("normalizes a bare hostname to https:// on save", () => {
    const onSave = vi.fn();
    render(
      <LinkPopover open initialText="" initialHref="" onSave={onSave} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "google.com" } });
    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onSave).toHaveBeenCalledWith({ text: "https://google.com", href: "https://google.com" });
  });

  it("leaves an already-absolute href unchanged on save", () => {
    const onSave = vi.fn();
    render(
      <LinkPopover open initialText="go" initialHref="" onSave={onSave} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "mailto:a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /insert/i }));
    expect(onSave).toHaveBeenCalledWith({ text: "go", href: "mailto:a@b.com" });
  });

  it("calls onCancel and not onSave when Cancel is clicked", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<LinkPopover open initialText="x" initialHref="https://x" onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not render Remove button when onRemove is not provided", () => {
    render(<LinkPopover open initialText="" initialHref="" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("renders Remove button and calls onRemove when clicked", () => {
    const onRemove = vi.fn();
    render(
      <LinkPopover
        open
        initialText="x"
        initialHref="https://x"
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("uses 'Save' label instead of 'Insert' when in edit mode (onRemove provided)", () => {
    render(
      <LinkPopover
        open
        initialText="x"
        initialHref="https://x"
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /insert/i })).toBeNull();
  });
});
