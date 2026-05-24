// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

const searchParamsRef: { value: URLSearchParams } = { value: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.value,
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const readerPropsRef: { value: Record<string, unknown> | null } = { value: null };

vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = (props: Record<string, unknown>) => {
      readerPropsRef.value = props;
      return <div data-testid="reader-stub" />;
    };
    return Stub;
  },
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

vi.mock("@/components/agent/AgentTranscript", () => ({
  AgentTranscript: () => <div data-testid="agent-transcript" />,
}));

vi.mock("@/state/agent-ball", () => ({
  useAgentBallStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        panelOpen: false,
        mountPoint: "reader-side-panel",
        activeThreadId: null,
        openInReader: () => {},
        close: () => {},
      }),
    {
      getState: () => ({
        activeThreadId: null,
        setActiveThread: () => {},
        close: () => {},
      }),
    },
  ),
}));

afterEach(() => {
  cleanup();
  searchParamsRef.value = new URLSearchParams();
  readerPropsRef.value = null;
});

describe("ReaderShell ?p= deep link (BG2a follow-up: prop-based)", () => {
  it("passes initialPage=3 to Reader when URL is ?p=3", async () => {
    searchParamsRef.value = new URLSearchParams("p=3");
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-1" />);
    await waitFor(() => {
      expect(readerPropsRef.value).not.toBeNull();
    });
    expect(readerPropsRef.value?.initialPage).toBe(3);
  });

  it("passes initialPage=undefined when ?p= is absent", async () => {
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-2" />);
    await waitFor(() => {
      expect(readerPropsRef.value).not.toBeNull();
    });
    expect(readerPropsRef.value?.initialPage).toBeUndefined();
  });

  it("passes initialPage=undefined for invalid ?p= (p=0, p=abc)", async () => {
    searchParamsRef.value = new URLSearchParams("p=0");
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-3" />);
    await waitFor(() => {
      expect(readerPropsRef.value).not.toBeNull();
    });
    expect(readerPropsRef.value?.initialPage).toBeUndefined();
  });
});

describe("ReaderShell explain-passage handler (K8 follow-up)", () => {
  it("POSTs /api/agents/km/invoke with page_context.paperId so threads get stamped", async () => {
    // Stub fetch for thread creation + invoke.
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agent/threads")) {
        return new Response(
          JSON.stringify({ thread: { threadId: "tid-xyz" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-explain" />);
    await waitFor(() => {
      expect(readerPropsRef.value).not.toBeNull();
    });

    const onExplain = readerPropsRef.value?.onExplainPassage as (a: {
      page: number;
      text: string;
    }) => Promise<void>;
    expect(typeof onExplain).toBe("function");

    await onExplain({ page: 4, text: "selected snippet" });

    const invokeCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/agents/km/invoke"),
    );
    expect(invokeCall).toBeDefined();
    const init = invokeCall![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      thread_id: string;
      message: string;
      page_context?: { paperId?: string };
    };
    expect(body.thread_id).toBe("tid-xyz");
    expect(body.page_context).toBeDefined();
    expect(body.page_context?.paperId).toBe("paper-explain");

    vi.unstubAllGlobals();
  });
});
