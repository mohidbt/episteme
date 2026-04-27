// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ModelPicker } from "./ModelPicker";
import { _resetCatalogCacheForTests } from "@/lib/openrouter-catalog";

beforeEach(() => {
  _resetCatalogCacheForTests();
  globalThis.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        models: [
          { id: "google/gemma-4-31b-it:free", name: "Gemma 4 Free" },
          { id: "anthropic/claude-opus-4-7", name: "Claude Opus 4.7" },
        ],
        fetched_at: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  _resetCatalogCacheForTests();
});

describe("ModelPicker", () => {
  it("fetches and renders model options", async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker value="google/gemma-4-31b-it:free" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/openrouter/catalog",
        expect.objectContaining({ method: "GET" }),
      );
    });

    const trigger = screen.getByTestId("model-picker-trigger");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText(/Gemma 4 Free/i)).toBeTruthy();
      expect(screen.getByText(/Claude Opus 4\.7/i)).toBeTruthy();
    });
  });

  it("renders options grouped by Free vs Paid", async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker value="google/gemma-4-31b-it:free" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    const trigger = screen.getByTestId("model-picker-trigger");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText("Free")).toBeTruthy();
      expect(screen.getByText("Paid")).toBeTruthy();
      expect(screen.getByRole("option", { name: /Gemma 4 Free/i })).toBeTruthy();
      expect(
        screen.getByRole("option", { name: /Claude Opus 4\.7/i }),
      ).toBeTruthy();
    });
  });
});
