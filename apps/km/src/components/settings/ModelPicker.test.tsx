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

let mockSessionUser: { isAnonymous?: boolean } | null = {
  isAnonymous: false,
};

vi.mock("@episteme/auth/client", () => ({
  useSession: () => ({ data: mockSessionUser ? { user: mockSessionUser } : null }),
}));

// Three models with mixed metadata:
// - "old" has earliest `created` timestamp (release date)
// - "new" has latest `created` timestamp
// - "undated-z" / "undated-a" have no `created` field (alphabetical at end)
const MOCK_MODELS = [
  { id: "vendor/new-model", name: "New Model", created: 1_700_000_000 },
  { id: "vendor/old-model", name: "Old Model", created: 1_500_000_000 },
  { id: "vendor/zeta-model", name: "Zeta Model" },
  { id: "vendor/alpha-model", name: "Alpha Model" },
  { id: "vendor/middle-model", name: "Middle Model", created: 1_600_000_000 },
];

beforeEach(() => {
  mockSessionUser = { isAnonymous: false };
  _resetCatalogCacheForTests();
  globalThis.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({ models: MOCK_MODELS, fetched_at: null }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  _resetCatalogCacheForTests();
});

async function openPicker() {
  const trigger = await screen.findByTestId("model-picker-trigger");
  fireEvent.click(trigger);
}

describe("ModelPicker", () => {
  it("fetches and renders model options", async () => {
    render(<ModelPicker value="vendor/old-model" onChange={vi.fn()} />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/openrouter/catalog",
        expect.objectContaining({ method: "GET" }),
      );
    });
    await openPicker();
    await waitFor(() => {
      const items = screen.getAllByTestId("model-picker-item");
      const labels = items.map((i) => i.textContent ?? "");
      expect(labels.some((l) => /Old Model/.test(l))).toBe(true);
      expect(labels.some((l) => /New Model/.test(l))).toBe(true);
    });
  });

  it("orders dated models descending by release date (newest first)", async () => {
    render(<ModelPicker value="vendor/old-model" onChange={vi.fn()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await openPicker();

    await waitFor(() => {
      const items = screen.getAllByTestId("model-picker-item");
      expect(items.length).toBe(MOCK_MODELS.length);
      // New (1.7e9) > Middle (1.6e9) > Old (1.5e9), then undated alphabetically
      expect(items[0].textContent).toMatch(/New Model/);
      expect(items[1].textContent).toMatch(/Middle Model/);
      expect(items[2].textContent).toMatch(/Old Model/);
    });
  });

  it("places undated models after dated, in alphabetical order", async () => {
    render(<ModelPicker value="vendor/old-model" onChange={vi.fn()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await openPicker();

    await waitFor(() => {
      const items = screen.getAllByTestId("model-picker-item");
      // Last two are undated → Alpha before Zeta
      expect(items[3].textContent).toMatch(/Alpha Model/);
      expect(items[4].textContent).toMatch(/Zeta Model/);
    });
  });

  it("shows 'Sign up to access all models.' empty copy when anonymous and zero matches after typeahead", async () => {
    mockSessionUser = { isAnonymous: true };

    render(<ModelPicker value="vendor/old-model" onChange={vi.fn()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await openPicker();
    const input = await screen.findByTestId("model-picker-search");
    fireEvent.change(input, { target: { value: "zzzzznoresult" } });

    await waitFor(() => {
      expect(
        screen.queryByText("Sign up to access all models."),
      ).not.toBeNull();
    });
    expect(screen.queryByText("No models match.")).toBeNull();
  });

  it("shows 'No models match.' for non-anonymous users when zero matches after typeahead", async () => {
    mockSessionUser = { isAnonymous: false };

    render(<ModelPicker value="vendor/old-model" onChange={vi.fn()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await openPicker();
    const input = await screen.findByTestId("model-picker-search");
    fireEvent.change(input, { target: { value: "zzzzznoresult" } });

    await waitFor(() => {
      expect(screen.queryAllByTestId("model-picker-item")).toHaveLength(0);
    });
    await waitFor(() => {
      expect(screen.queryByText("No models match.")).not.toBeNull();
    });
    expect(
      screen.queryByText("Sign up to access all models."),
    ).toBeNull();
  });

  it("typeahead filters list as the user types", async () => {
    render(<ModelPicker value="vendor/old-model" onChange={vi.fn()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await openPicker();

    const input = await screen.findByTestId("model-picker-search");
    // Type 4+ chars matching only "Zeta Model"
    fireEvent.change(input, { target: { value: "Zeta" } });

    await waitFor(() => {
      const items = screen.getAllByTestId("model-picker-item");
      expect(items.length).toBe(1);
      expect(items[0].textContent).toMatch(/Zeta Model/);
    });
  });
});
