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
  modelPreference: "google/gemma-4-31b-it:free",
  approvalRules: {} as Record<string, "auto" | "require" | "never">,
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/openrouter/catalog")) {
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
  it("renders three tabs (Skills, MCPs, Rules)", () => {
    render(<PermissionsForm initial={initial} />);
    expect(screen.getByRole("tab", { name: /skills/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /mcps/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /rules/i })).toBeTruthy();
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
