import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ApiKeysManager } from "../api-keys-manager";

afterEach(() => cleanup());

describe("ApiKeysManager — Semantic Scholar row", () => {
  beforeEach(() => {
    // Stub fetch so the component doesn't blow up on mount
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [] }),
    }));
  });

  it("renders Semantic Scholar option in provider type select", async () => {
    render(<ApiKeysManager />);
    const select = screen.getByLabelText(/provider type/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("references");
  });

  it("renders Semantic Scholar label text", () => {
    render(<ApiKeysManager />);
    expect(screen.getByText(/semantic scholar/i)).toBeTruthy();
  });
});

describe("ApiKeysManager — Chandra key missing banner", () => {
  it("shows banner when no keys are present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ keys: [] }),
    }));

    render(<ApiKeysManager />);

    await waitFor(() => {
      const banner = screen.getByTestId("chandra-missing-banner");
      expect(banner).toBeTruthy();
      expect(banner.textContent).toMatch(/Configure Chandra key to enable Smart Explanations/);
    });
  });

  it("shows banner when non-Chandra keys are present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        keys: [
          {
            id: 1,
            providerType: "llm",
            providerName: "openrouter",
            keyPreview: "sk-...abc",
            isValid: true,
            storageMode: "cloud",
            createdAt: "2024-01-01",
          },
        ],
      }),
    }));

    render(<ApiKeysManager />);

    await waitFor(() => {
      const banner = screen.getByTestId("chandra-missing-banner");
      expect(banner).toBeTruthy();
    });
  });

  it("hides banner when Chandra key is present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        keys: [
          {
            id: 1,
            providerType: "ocr",
            providerName: "chandra",
            keyPreview: "chandra-...xyz",
            isValid: true,
            storageMode: "cloud",
            createdAt: "2024-01-01",
          },
        ],
      }),
    }));

    render(<ApiKeysManager />);

    await waitFor(() => {
      const banner = screen.queryByTestId("chandra-missing-banner");
      expect(banner).toBeNull();
    });
  });

  it("does not show banner during loading state", async () => {
    let resolveGate: any;
    const gate = new Promise((resolve) => {
      resolveGate = resolve;
    });

    vi.stubGlobal("fetch", vi.fn(() => gate));

    render(<ApiKeysManager />);

    // While loading, banner should not be visible
    expect(screen.queryByTestId("chandra-missing-banner")).toBeNull();

    // After fetch resolves, banner appears
    resolveGate({
      ok: true,
      json: async () => ({ keys: [] }),
    });

    await waitFor(() => {
      const banner = screen.getByTestId("chandra-missing-banner");
      expect(banner).toBeTruthy();
    });
  });
});
