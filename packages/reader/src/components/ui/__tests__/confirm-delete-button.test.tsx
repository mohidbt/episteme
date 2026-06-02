import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmDeleteButton } from "../confirm-delete-button";

afterEach(() => cleanup());

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

  it("calls onConfirm when the action button is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteButton
        ariaLabel="Delete"
        title="Delete this?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Two "Delete" buttons exist now (trigger + action). Pick the action
    // (data-slot=alert-dialog-action) explicitly.
    const action = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>(
        "[data-slot=alert-dialog-action]",
      );
      if (!el) throw new Error("action not mounted");
      return el;
    });
    fireEvent.click(action);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("does not call onConfirm when cancel is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDeleteButton
        ariaLabel="Delete"
        title="Delete this?"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const cancel = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>(
        "[data-slot=alert-dialog-cancel]",
      );
      if (!el) throw new Error("cancel not mounted");
      return el;
    });
    fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows pending state and disables buttons while async onConfirm resolves", async () => {
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(
      () => new Promise<void>((resolve) => { resolveConfirm = resolve; }),
    );
    render(
      <ConfirmDeleteButton
        ariaLabel="Delete"
        title="Delete this?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const action = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>(
        "[data-slot=alert-dialog-action]",
      );
      if (!el) throw new Error("action not mounted");
      return el;
    });
    fireEvent.click(action);
    await waitFor(() => expect(action.disabled).toBe(true));
    expect(action.textContent).toContain("Delete…");
    resolveConfirm();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
