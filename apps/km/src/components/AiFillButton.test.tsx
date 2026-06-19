// @vitest-environment jsdom
// #69 — friendly OpenRouter key error rendering.
// #101 — verify cslJson PATCH body for references.
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
  globalThis.confirm = vi.fn(() => true);
});

afterEach(() => {
  cleanup();
});

describe("AiFillButton — trial-exhausted (GSD-126 P1a)", () => {
  it("shows the trial-exhausted upgrade toast on 402 + trial_exhausted body", async () => {
    // Reset dedup window so toast actually fires regardless of test order.
    try {
      sessionStorage.removeItem("episteme:trial-exhausted-last-shown");
    } catch {
      // sessionStorage may not exist in this run — ignore.
    }

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "trial_exhausted" }), {
        status: 402,
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
      const args = errMock.mock.calls[0]!;
      expect(String(args[0])).toMatch(/\$5 AI trial/);
      expect(String(args[0])).toMatch(/founders@episteme\.app/);
    });
  });
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

// #101 — References PATCH body must use cslJson, not raw denormalised fields
describe("AiFillButton — reference cslJson PATCH (#101)", () => {
  it("for kind=reference, sends { cslJson } in PATCH body, not raw fields", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ suggestions: { title: "A Paper", year: 2024, doi: "10.1/x" } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "r1" }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AiFillButton
        patchUrl="/api/references/r1"
        kind="reference"
        known={{ citationKey: "smith2020" }}
        missing={["title", "year", "doi"]}
        cslJson={{ id: "r1", type: "article-journal" }}
      />,
    );
    fireEvent.click(screen.getByTestId("ai-fill-button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, patchInit] = fetchMock.mock.calls[1]!;
    const patchBody = JSON.parse((patchInit as RequestInit).body as string);

    // PATCH body must have cslJson, not raw title/year/doi
    expect("cslJson" in patchBody).toBe(true);
    expect("title" in patchBody).toBe(false);
    expect("year" in patchBody).toBe(false);

    // cslJson must contain CSL-formatted fields
    expect(patchBody.cslJson.title).toBe("A Paper");
    expect(patchBody.cslJson.issued).toEqual({ "date-parts": [[2024]] });
    expect(patchBody.cslJson.DOI).toBe("10.1/x");
    // Existing cslJson fields must be preserved
    expect(patchBody.cslJson.id).toBe("r1");
    expect(patchBody.cslJson.type).toBe("article-journal");
  });

  it("for kind=paper, sends raw suggestions directly (no cslJson wrapping)", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ suggestions: { title: "A Paper", year: 2024 } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "p1" }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <AiFillButton
        patchUrl="/api/papers/p1"
        kind="paper"
        known={{}}
        missing={["title", "year"]}
      />,
    );
    fireEvent.click(screen.getByTestId("ai-fill-button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const [, patchInit] = fetchMock.mock.calls[1]!;
    const patchBody = JSON.parse((patchInit as RequestInit).body as string);

    // For papers, raw suggestions are sent directly
    expect("title" in patchBody).toBe(true);
    expect("year" in patchBody).toBe(true);
    expect("cslJson" in patchBody).toBe(false);
  });
});
