// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ApprovalRules } from "./ApprovalRules";

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
    { name: "publish", description: "Publish a note.", category: "notes", gateable: true, default_allowed: true },
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

describe("ApprovalRules (GSD-44)", () => {
  it("renders a loading state while the tools fetch is in flight", () => {
    let resolveFetch!: (r: Response) => void;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = res;
        }),
    ) as unknown as typeof fetch;

    render(<ApprovalRules approvalRules={{}} onChange={vi.fn()} />);
    expect(screen.getByTestId("approval-rules-loading")).toBeTruthy();
    resolveFetch(
      new Response(JSON.stringify(TOOLS_FIXTURE), { status: 200 }),
    );
  });

  it("renders dynamic tools grouped by category", async () => {
    mockToolsFetch();
    render(<ApprovalRules approvalRules={{}} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByRole("group", { name: /approval rule for web search/i }),
      ).toBeTruthy();
    });
    expect(screen.getAllByText(/^Notes$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Paper Search$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Web$/i).length).toBeGreaterThan(0);
  });

  it('defaults rule to "require" when no saved value', async () => {
    mockToolsFetch();
    render(<ApprovalRules approvalRules={{}} onChange={vi.fn()} />);
    await waitFor(() => {
      // For each tool group, the "Require" toggle should be aria-pressed=true.
      const group = screen.getByRole("group", {
        name: /approval rule for create note/i,
      });
      const requireBtn = group.querySelector(
        '[aria-label="Require"]',
      ) as HTMLButtonElement;
      expect(requireBtn.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("reflects an explicit saved rule value", async () => {
    mockToolsFetch();
    render(
      <ApprovalRules
        approvalRules={{ create_note: "auto" }}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      const group = screen.getByRole("group", {
        name: /approval rule for create note/i,
      });
      const auto = group.querySelector(
        '[aria-label="Auto"]',
      ) as HTMLButtonElement;
      expect(auto.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("emits onChange merging the new value with prior state", async () => {
    mockToolsFetch();
    const onChange = vi.fn();
    render(
      <ApprovalRules
        approvalRules={{ web_search: "never" }}
        onChange={onChange}
      />,
    );
    const group = await screen.findByRole("group", {
      name: /approval rule for create note/i,
    });
    const autoBtn = group.querySelector(
      '[aria-label="Auto"]',
    ) as HTMLButtonElement;
    fireEvent.click(autoBtn);
    expect(onChange).toHaveBeenCalledWith({
      web_search: "never",
      create_note: "auto",
    });
  });

  it("humanizes snake_case tool names for display", async () => {
    mockToolsFetch();
    render(<ApprovalRules approvalRules={{}} onChange={vi.fn()} />);
    await screen.findByText(/agentic search papers/i);
  });

  it('disables the "never" option for the publish tool', async () => {
    mockToolsFetch();
    render(<ApprovalRules approvalRules={{}} onChange={vi.fn()} />);
    const group = await screen.findByRole("group", {
      name: /approval rule for publish/i,
    });
    const never = group.querySelector(
      '[aria-label="Never"]',
    ) as HTMLButtonElement;
    expect(never.disabled).toBe(true);
  });

  it("renders saved rules for removed tools in a Removed group with a (removed) tag", async () => {
    mockToolsFetch();
    render(
      <ApprovalRules
        approvalRules={{ ancient_tool: "auto", web_search: "auto" }}
        onChange={vi.fn()}
      />,
    );
    await screen.findByRole("group", {
      name: /approval rule for web search/i,
    });
    expect(screen.getByText(/ancient tool/i)).toBeTruthy();
    expect(screen.getByText(/\(removed\)/i)).toBeTruthy();
  });

  it("renders a fallback error state when the fetch rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    render(<ApprovalRules approvalRules={{}} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId("approval-rules-error")).toBeTruthy();
    });
  });
});
