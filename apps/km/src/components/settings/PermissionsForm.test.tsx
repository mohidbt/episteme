// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { PermissionsForm } from "./PermissionsForm";

const initial = {
  enabledSkills: [] as string[],
  attachedMcps: [] as Array<{ name: string; account?: string }>,
  modelPreference: "google/gemma-4-26b-a4b-it",
  approvalRules: {} as Record<string, "auto" | "require" | "never">,
  permissions: { web_search: false } as Record<string, boolean>,
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/openrouter/catalog")) {
      return new Response(
        JSON.stringify({
          models: [
            { id: "google/gemma-4-26b-a4b-it", name: "Gemma 4 Free" },
            { id: "anthropic/claude-opus-4-7", name: "Claude Opus 4.7" },
          ],
          fetched_at: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/agents/km/config")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PermissionsForm", () => {
  it("renders four tabs (Skills, MCPs, Rules, Permissions)", () => {
    render(<PermissionsForm initial={initial} />);
    expect(screen.getByRole("tab", { name: /skills/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /mcps/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /rules/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /permissions/i })).toBeTruthy();
  });

  it("renders web_search permission toggle defaulted to off", async () => {
    render(<PermissionsForm initial={initial} />);
    fireEvent.click(screen.getByRole("tab", { name: /permissions/i }));
    await waitFor(() => {
      const toggle = screen.getByRole("switch", { name: /web search/i }) as HTMLButtonElement;
      // shadcn Switch reflects state via aria-checked / data-state
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("toggling web_search and saving sends PATCH with permissions.web_search=true", async () => {
    render(<PermissionsForm initial={initial} />);
    fireEvent.click(screen.getByRole("tab", { name: /permissions/i }));

    const toggle = await waitFor(() =>
      screen.getByRole("switch", { name: /web search/i }),
    );
    fireEvent.click(toggle);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
        .mock.calls as unknown[][];
      const patch = calls.find(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/api/agents/km/config") &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
      expect(body.permissions).toEqual({ web_search: true });
    });
  });

  it("switches tabs on click", async () => {
    render(<PermissionsForm initial={initial} />);
    // skills tab default selected -> shows "Literature Triage"
    expect(screen.getByText(/Literature Triage/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    await waitFor(() => {
      expect(screen.getByText(/Create note/i)).toBeTruthy();
    });
  });

  it("toggling a skill switch + saving sends PATCH with updated enabledSkills", async () => {
    render(<PermissionsForm initial={initial} />);

    const triageSwitch = screen.getByRole("switch", { name: /Literature Triage/i });
    fireEvent.click(triageSwitch);

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
        .mock.calls as unknown[][];
      const patch = calls.find(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/api/agents/km/config") &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse(((patch![1] as RequestInit).body as string) ?? "{}");
      expect(body.enabledSkills).toContain("lit-triage");
    });

    await waitFor(() => {
      expect((toast.success as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        "Settings saved",
      );
    });
  });

  it("Save button becomes disabled after a successful save (Task #34)", async () => {
    render(<PermissionsForm initial={initial} />);

    // Initially the form is pristine — Save is disabled.
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Toggle a skill to dirty the form.
    const triageSwitch = screen.getByRole("switch", { name: /Literature Triage/i });
    fireEvent.click(triageSwitch);

    // Save button is now enabled.
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });

    // Click save and wait for the success toast.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect((toast.success as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
        "Settings saved",
      );
    });

    // After the save, the form is pristine relative to the just-saved state —
    // Save must be disabled again until the user changes something else.
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });
  });

  it("calls toast.error when PATCH fails", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/openrouter/catalog")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    }) as unknown as typeof fetch;

    render(<PermissionsForm initial={initial} />);
    const triageSwitch = screen.getByRole("switch", { name: /Literature Triage/i });
    fireEvent.click(triageSwitch);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect((toast.error as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
  });
});
