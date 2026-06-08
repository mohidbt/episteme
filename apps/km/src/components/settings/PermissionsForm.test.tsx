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
  modelPreference: "openai/gpt-5.4-nano",
  approvalRules: {} as Record<string, "auto" | "require" | "never">,
  // K12: web_search defaults ON. Empty permissions object matches what a
  // freshly-onboarded user gets from the page loader, so the UI's defaultOn
  // metadata drives the initial toggle state.
  permissions: {} as Record<string, boolean>,
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/openrouter/catalog")) {
      return new Response(
        JSON.stringify({
          models: [
            { id: "openai/gpt-5.4-nano", name: "GPT-5.4 nano" },
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
    if (url.includes("/api/agents/km/tools")) {
      return new Response(
        JSON.stringify({
          tools: [
            {
              name: "web_search",
              description: "Search the web.",
              category: "web",
              gateable: true,
              default_allowed: true,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
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
  it("renders section pills with Round-7 taxonomy labels", () => {
    render(<PermissionsForm initial={initial} />);
    expect(screen.getByTestId("perm-section-skills")).toBeTruthy();
    expect(screen.getByTestId("perm-section-mcps")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Permissions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tools" })).toBeTruthy();
  });

  it("renders web_search permission toggle defaulted to on (K12)", async () => {
    render(<PermissionsForm initial={initial} />);
    fireEvent.click(screen.getByTestId("perm-section-permissions"));
    await waitFor(() => {
      const toggle = screen.getByRole("switch", { name: /web search/i }) as HTMLButtonElement;
      // shadcn Switch reflects state via aria-checked / data-state.
      // Empty permissions + defaultOn:true → toggle is checked.
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("toggling web_search off and saving sends PATCH with permissions.web_search=false", async () => {
    render(<PermissionsForm initial={initial} />);
    fireEvent.click(screen.getByTestId("perm-section-permissions"));

    const toggle = await waitFor(() =>
      screen.getByRole("switch", { name: /web search/i }),
    );
    // Initial state is on (default); clicking toggles to off.
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
      expect(body.permissions).toEqual({ web_search: false });
    });
  });

  it("switches sections on click", async () => {
    render(<PermissionsForm initial={initial} />);
    // skills section default selected -> shows "Literature Triage"
    expect(screen.getByText(/Literature Triage/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId("perm-section-rules"));
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
