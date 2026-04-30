// @vitest-environment jsdom
// #69 — friendly OpenRouter key error rendering.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { toast } from "sonner";
import { AiFillButton } from "./AiFillButton";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AiFillButton — OpenRouter key error", () => {
  it("shows friendly message + settings link when API returns OPENROUTER_KEY_MISSING", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "OPENROUTER_KEY_MISSING" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    render(
      <AiFillButton
        patchUrl="/api/papers/1"
        kind="paper"
        known={{}}
        missing={["title"]}
      />,
    );
    fireEvent.click(screen.getByTestId("ai-fill-button"));

    await waitFor(() => {
      const errMock = toast.error as unknown as ReturnType<typeof vi.fn>;
      expect(errMock).toHaveBeenCalled();
      const [title, opts] = errMock.mock.calls[0]! as [string, { description?: unknown }];
      expect(String(title)).toMatch(/OpenRouter API key/i);
      // description is a React element with a Link to /settings/agents.
      const { container } = render(<>{opts.description as React.ReactNode}</>);
      const link = container.querySelector('a[href="/settings/agents"]');
      expect(link).toBeTruthy();
    });
  });

  it("shows friendly message when API returns OPENROUTER_KEY_INVALID", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "OPENROUTER_KEY_INVALID" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    render(
      <AiFillButton
        patchUrl="/api/papers/1"
        kind="paper"
        known={{}}
        missing={["title"]}
      />,
    );
    fireEvent.click(screen.getByTestId("ai-fill-button"));

    await waitFor(() => {
      const errMock = toast.error as unknown as ReturnType<typeof vi.fn>;
      expect(errMock).toHaveBeenCalled();
      const [title, opts] = errMock.mock.calls[0]! as [string, { description?: unknown }];
      expect(String(title)).toMatch(/OpenRouter API key/i);
      const { container } = render(<>{opts.description as React.ReactNode}</>);
      const link = container.querySelector('a[href="/settings/agents"]');
      expect(link).toBeTruthy();
    });
  });
});
