// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PermissionToggles } from "./PermissionToggles";

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const TOOLS_FIXTURE = {
  tools: [
    { name: "web_search", description: "Search the web via Tavily.", category: "web", gateable: true, default_allowed: true },
    { name: "create_note", description: "Create a new note.", category: "notes", gateable: true, default_allowed: true },
    { name: "list_notes", description: "List notes.", category: "notes", gateable: true, default_allowed: true },
    { name: "agentic_search_papers", description: "Search papers.", category: "paper_search", gateable: true, default_allowed: true },
  ],
};

function mockToolsFetch(payload: unknown = TOOLS_FIXTURE) {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("PermissionToggles (GSD-33)", () => {
  it("renders a loading state while the tools fetch is in flight", () => {
    let resolveFetch!: (r: Response) => void;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = res;
        }),
    ) as unknown as typeof fetch;

    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    expect(screen.getByTestId("permission-toggles-loading")).toBeTruthy();
    resolveFetch(
      new Response(JSON.stringify(TOOLS_FIXTURE), { status: 200 }),
    );
  });

  it("renders the dynamic tool list grouped by category", async () => {
    mockToolsFetch();
    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    // Wait for fetch resolution
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /web search/i })).toBeTruthy();
    });
    // Categories rendered as headings (web, notes, paper_search)
    expect(screen.getByText(/notes/i)).toBeTruthy();
    expect(screen.getByText(/paper search/i)).toBeTruthy();
  });

  it("defaults toggle to ON when permission key is missing", async () => {
    mockToolsFetch();
    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    const sw = await screen.findByRole("switch", { name: /create note/i });
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("renders OFF when permission is explicit false", async () => {
    mockToolsFetch();
    render(
      <PermissionToggles
        permissions={{ create_note: false }}
        onChange={vi.fn()}
      />,
    );
    const sw = await screen.findByRole("switch", { name: /create note/i });
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("emits onChange merging the toggled key with prior state", async () => {
    mockToolsFetch();
    const onChange = vi.fn();
    render(
      <PermissionToggles
        permissions={{ web_search: false }}
        onChange={onChange}
      />,
    );
    const sw = await screen.findByRole("switch", { name: /create note/i });
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith({ web_search: false, create_note: false });
  });

  it("humanizes snake_case tool names for display", async () => {
    mockToolsFetch();
    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    // agentic_search_papers → Agentic Search Papers
    await screen.findByText(/agentic search papers/i);
  });

  it("renders TOOL_DESCRIPTION_OVERRIDES text instead of raw BaseTool description for overridden tools", async () => {
    mockToolsFetch();
    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    await screen.findByRole("switch", { name: /web search/i });
    // web_search is in the override map — the upstream description
    // "Search the web via Tavily." should NOT appear; the override should.
    // The override copy avoids the Tavily brand name (RG1 #66).
    const html = document.body.textContent ?? "";
    expect(html).not.toMatch(/tavily/i);
  });

  it("renders a fallback error state when the fetch rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    render(<PermissionToggles permissions={{}} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("permission-toggles-error")).toBeTruthy();
    });
  });
});
