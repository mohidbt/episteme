// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { AskNotesPanel } from "./AskNotesPanel";
import type { RunAskNotesInput } from "@/lib/ai/run-ask-notes";

const runMock = vi.fn();
vi.mock("@/lib/ai/run-ask-notes", () => ({
  runAskNotes: (input: RunAskNotesInput) => runMock(input),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  runMock.mockReset();
  pushMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /ask my notes/i }));
}

function typeAndSend(q: string) {
  const input = screen.getByPlaceholderText(/ask a question/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: q } });
  fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
}

describe("AskNotesPanel", () => {
  it("opens panel on trigger click", async () => {
    render(<AskNotesPanel />);
    openPanel();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("sends question via runAskNotes on Send", async () => {
    runMock.mockImplementation(async () => {
      /* no-op */
    });
    render(<AskNotesPanel />);
    openPanel();
    typeAndSend("what is X?");

    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(1));
    const arg = runMock.mock.calls[0][0] as RunAskNotesInput;
    expect(arg.question).toBe("what is X?");
    expect(arg.history).toEqual([]);
  });

  it("renders sources as clickable pills pointing to /n/:slug", async () => {
    runMock.mockImplementation(async (input: RunAskNotesInput) => {
      input.onSources([
        { id: "n1", title: "Transformers", slug: "transformers", snippet: "s" },
        { id: "n2", title: "Attention", slug: "attention", snippet: "s2" },
      ]);
      input.onToken("Answer");
    });
    render(<AskNotesPanel />);
    openPanel();
    typeAndSend("explain");

    await waitFor(() => {
      expect(screen.getByText("Transformers")).toBeTruthy();
      expect(screen.getByText("Attention")).toBeTruthy();
    });
    const pill = screen.getByText("Transformers").closest("a");
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("href")).toBe("/n/transformers");
  });

  it("appends assistant tokens to the streaming message", async () => {
    runMock.mockImplementation(async (input: RunAskNotesInput) => {
      input.onToken("Hel");
      input.onToken("lo");
      input.onToken(" world");
    });
    render(<AskNotesPanel />);
    openPanel();
    typeAndSend("hi");

    await waitFor(() => {
      expect(screen.getByTestId("assistant-msg-0").textContent).toContain(
        "Hello world",
      );
    });
  });

  it("supports a follow-up question after the first completes", async () => {
    runMock.mockImplementationOnce(async (input: RunAskNotesInput) => {
      input.onToken("A1");
    });
    runMock.mockImplementationOnce(async () => {
      /* no-op */
    });

    render(<AskNotesPanel />);
    openPanel();
    typeAndSend("Q1");

    await waitFor(() => {
      expect(screen.getByTestId("assistant-msg-0").textContent).toContain("A1");
    });

    typeAndSend("Q2");

    await waitFor(() => expect(runMock).toHaveBeenCalledTimes(2));
    const arg = runMock.mock.calls[1][0] as RunAskNotesInput;
    expect(arg.question).toBe("Q2");
    expect(arg.history).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
    ]);
  });

  it("aborts in-flight stream when panel closes", async () => {
    let capturedSignal: AbortSignal | undefined;
    runMock.mockImplementation(async (input: RunAskNotesInput) => {
      capturedSignal = input.signal;
      // Never resolves — simulates in-flight
      await new Promise(() => {});
    });
    render(<AskNotesPanel />);
    openPanel();
    typeAndSend("q");

    await waitFor(() => expect(runMock).toHaveBeenCalled());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Close panel via Escape or re-click. We'll use fireEvent.keyDown on document.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    await waitFor(() => {
      expect(capturedSignal!.aborted).toBe(true);
    });
  });

  it("empty retrieval: notes=[] renders fallback token text, no pills", async () => {
    runMock.mockImplementation(async (input: RunAskNotesInput) => {
      input.onSources([]);
      input.onToken("I could not find any relevant notes.");
    });
    render(<AskNotesPanel />);
    openPanel();
    typeAndSend("obscure topic");

    await waitFor(() => {
      expect(screen.getByTestId("assistant-msg-0").textContent).toContain(
        "I could not find any relevant notes.",
      );
    });
    // No pill links rendered
    const container = screen.getByTestId("assistant-msg-0").parentElement!;
    expect(container.querySelectorAll("a[href^='/n/']").length).toBe(0);
  });
});
