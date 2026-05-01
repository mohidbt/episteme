// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { PersonalSkills } from "./PersonalSkills";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/agents/skills/personal") && (!init || !init.method || init.method === "GET")) {
      return new Response(JSON.stringify({ skills: [] }), { status: 200 });
    }
    if (u.endsWith("/api/agents/skills/personal") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          slug: body.name.toLowerCase().replace(/\s+/g, "-"),
          name: body.name,
          description: "",
          category: "writing",
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("PersonalSkills", () => {
  it("renders + new skill button", async () => {
    render(<PersonalSkills />);
    await waitFor(() => {
      expect(screen.getByTestId("new-skill-button")).toBeTruthy();
    });
  });

  it("clicking + new skill opens dialog and submitting creates a row", async () => {
    render(<PersonalSkills />);
    await waitFor(() => screen.getByTestId("new-skill-button"));

    fireEvent.click(screen.getByTestId("new-skill-button"));
    const input = (await screen.findByTestId("new-skill-name-input")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Tone" } });
    fireEvent.click(screen.getByTestId("new-skill-submit"));

    await waitFor(() => {
      expect(screen.queryByTestId("personal-skill-row-tone")).toBeTruthy();
    });
  });

  it("clicking edit opens textarea editor", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/agents/skills/personal")) {
        return new Response(
          JSON.stringify({
            skills: [
              { slug: "alpha", name: "Alpha", description: "", category: "writing" },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/agents/skills/personal/alpha")) {
        return new Response(
          JSON.stringify({ slug: "alpha", md: "stub" }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    render(<PersonalSkills />);
    const editBtn = await screen.findByTestId("edit-skill-alpha");
    fireEvent.click(editBtn);
    await waitFor(() => {
      expect(screen.getByTestId("edit-skill-textarea")).toBeTruthy();
    });
  });

  it("clicking edit fetches real body and prefills textarea", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/agents/skills/personal")) {
        return new Response(
          JSON.stringify({
            skills: [
              { slug: "alpha", name: "Alpha", description: "", category: "writing" },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/agents/skills/personal/alpha")) {
        return new Response(
          JSON.stringify({
            slug: "alpha",
            md: "---\nname: Alpha\n---\n# Real body content from server",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<PersonalSkills />);
    const editBtn = await screen.findByTestId("edit-skill-alpha");
    fireEvent.click(editBtn);

    const textarea = (await screen.findByTestId(
      "edit-skill-textarea",
    )) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toContain("Real body content from server");
    });
    expect(textarea.value).not.toMatch(/^---\nname: alpha\n---\n\n# alpha/);

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls).toContain("/api/agents/skills/personal/alpha");
  });
});
