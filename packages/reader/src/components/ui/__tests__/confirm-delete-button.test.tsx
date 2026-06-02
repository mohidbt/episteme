import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmDeleteButton } from "../confirm-delete-button";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

afterEach(() => {
  cleanup();
  toastError.mockReset();
});

const action = () =>
  document.querySelector<HTMLButtonElement>("[data-slot=alert-dialog-action]");
const cancel = () =>
  document.querySelector<HTMLButtonElement>("[data-slot=alert-dialog-cancel]");
const title = (label: string) =>
  document.querySelector<HTMLElement>(`[data-slot=alert-dialog-title]`)?.textContent === label;

describe("ConfirmDeleteButton", () => {
  it("renders trigger with the provided aria-label", () => {
    render(
      <ConfirmDeleteButton
        ariaLabel="Delete highlight run"
        title="Delete?"
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete highlight run" })).toBeDefined();
  });

  it("does not call onConfirm until the dialog action is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteButton
        ariaLabel="Delete"
        title="Delete this?"
        description="cannot be undone"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Dialog visible; onConfirm still not fired.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this?")).toBeDefined();
    expect(screen.getByText("cannot be undone")).toBeDefined();
  });

  it("closes the dialog on successful onConfirm (void return)", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteButton ariaLabel="Delete" title="Delete this?" onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(action()).not.toBeNull());
    fireEvent.click(action()!);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // Dialog should unmount after successful resolution.
    await waitFor(() => expect(action()).toBeNull());
  });

  it("keeps the dialog open when onConfirm returns false (failure signal)", async () => {
    const onConfirm = vi.fn(() => false);
    render(
      <ConfirmDeleteButton ariaLabel="Delete" title="Delete this?" onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(action()).not.toBeNull());
    fireEvent.click(action()!);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // Dialog must remain mounted so the user can retry / cancel.
    expect(action()).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and surfaces a toast when onConfirm throws", async () => {
    const onConfirm = vi.fn(async () => { throw new Error("boom"); });
    render(
      <ConfirmDeleteButton
        ariaLabel="Delete"
        title="Delete this?"
        failureMessage="Could not delete."
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(action()).not.toBeNull());
    fireEvent.click(action()!);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not delete."));
    expect(action()).not.toBeNull();
  });

  it("does not call onConfirm when cancel is clicked, and closes the dialog", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteButton ariaLabel="Delete" title="Delete this?" onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(cancel()).not.toBeNull());
    fireEvent.click(cancel()!);
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(cancel()).toBeNull());
  });

  it("holds the dialog open with pending state until async onConfirm resolves, then closes", async () => {
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(
      () => new Promise<void>((resolve) => { resolveConfirm = resolve; }),
    );
    render(
      <ConfirmDeleteButton ariaLabel="Delete" title="Delete this?" onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(action()).not.toBeNull());
    fireEvent.click(action()!);
    // While pending: the action stays mounted, disabled, and shows the
    // pending glyph — this is the load-bearing behavior the prior test
    // only weakly checked (codex review fix #5).
    await waitFor(() => expect(action()!.disabled).toBe(true));
    expect(action()!.textContent).toContain("Delete…");
    expect(cancel()!.disabled).toBe(true);
    // Resolve and confirm close.
    resolveConfirm();
    await waitFor(() => expect(action()).toBeNull());
  });

  it("renders the title via the title slot for screen-reader naming", () => {
    render(
      <ConfirmDeleteButton ariaLabel="Delete" title="Custom title" onConfirm={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(title("Custom title")).toBe(true);
  });
});
