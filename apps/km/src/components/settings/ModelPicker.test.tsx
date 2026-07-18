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

  // GSD-31 — render a $ / $$ / $$$ price tier badge sourced from the
  // OpenRouter completion price already in the catalog payload. The badge
  // colour comes from the tier (low → green, mid → yellow, high → red);
  // missing pricing renders no badge.
  it("GSD-31: renders price-tier badge for each priced model and skips unpriced rows", async () => {
    const priced = [
      {
        id: "vendor/cheap",
        name: "Cheap Model",
        created: 1_700_000_000,
        pricing: { prompt: "0", completion: "0.0000004" }, // $0.40/M → low
      },
      {
        id: "vendor/mid",
        name: "Mid Model",
        created: 1_650_000_000,
        pricing: { prompt: "0", completion: "0.000005" }, // $5/M → mid
      },
      {
        id: "vendor/premium",
        name: "Premium Model",
        created: 1_600_000_000,
        pricing: { prompt: "0", completion: "0.000075" }, // $75/M → high
      },
      {
        id: "vendor/unknown",
        name: "Unknown Price",
        created: 1_550_000_000,
        /* no pricing key */
      },
    ];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ models: priced, fetched_at: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    render(<ModelPicker value="vendor/cheap" onChange={vi.fn()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await openPicker();

    const items = await screen.findAllByTestId("model-picker-item");
    const findBadge = (label: RegExp) => {
      const item = items.find((el) => label.test(el.textContent ?? ""));
      if (!item) throw new Error(`no item matching ${label}`);
      return item.querySelector('[data-testid="model-price-tier"]');
    };

    const lowBadge = findBadge(/Cheap Model/);
    expect(lowBadge?.textContent).toBe("$");
    expect(lowBadge?.getAttribute("data-tier")).toBe("low");

    const midBadge = findBadge(/Mid Model/);
    expect(midBadge?.textContent).toBe("$$");
    expect(midBadge?.getAttribute("data-tier")).toBe("mid");

    const highBadge = findBadge(/Premium Model/);
    expect(highBadge?.textContent).toBe("$$$");
    expect(highBadge?.getAttribute("data-tier")).toBe("high");

    // No badge for the un-priced row.
    expect(findBadge(/Unknown Price/)).toBeNull();
  });

  // GSD-144 — the $ / $$ / $$$ badges must align into a single column: a
  // fixed-width, centered box so every tier's box occupies the same width and
  // the badges' right edges line up regardless of "$" vs "$$" vs "$$$" length.
  it("GSD-144: badges share a fixed-width centered box so the $ column is aligned", async () => {
    const priced = [
      {
        id: "vendor/cheap",
        name: "Cheap Model",
        created: 1_700_000_000,
        pricing: { prompt: "0", completion: "0.0000004" }, // low → "$"
      },
      {
        id: "vendor/premium",
        name: "Premium Model",
        created: 1_600_000_000,
        pricing: { prompt: "0", completion: "0.000075" }, // high → "$$$"
      },
    ];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ models: priced, fetched_at: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    render(<ModelPicker value="vendor/cheap" onChange={vi.fn()} />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await openPicker();

    const items = await screen.findAllByTestId("model-picker-item");
    const badges = items
      .map((el) => el.querySelector('[data-testid="model-price-tier"]'))
      .filter((b): b is Element => b !== null);
    expect(badges.length).toBe(2);

    for (const badge of badges) {
      const cls = badge.getAttribute("class") ?? "";
      // Fixed-width box (all tiers same width) → column right edges align.
      expect(cls).toMatch(/\bw-\d/);
      // Content centered inside the fixed-width box.
      expect(cls).toContain("text-center");
    }

    // The real alignment fix: each row is full width and the name span
    // consumes the free space (flex-1 min-w-0), so ml-auto pushes the badge
    // to a constant right column instead of resolving against per-row content
    // width. Without this the badge right-edges are ragged even with a
    // fixed-width box.
    for (const item of items) {
      const rowCls = item.getAttribute("class") ?? "";
      expect(rowCls).toContain("w-full");
      const nameSpan = item.querySelector("span.truncate");
      expect(nameSpan).not.toBeNull();
      const nameCls = nameSpan?.getAttribute("class") ?? "";
      expect(nameCls).toContain("flex-1");
      expect(nameCls).toContain("min-w-0");
    }
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
