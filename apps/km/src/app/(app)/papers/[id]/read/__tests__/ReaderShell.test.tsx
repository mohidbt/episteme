// @vitest-environment jsdom
import type React from "react";
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
      // Render the agentSlot so children (PastThreadsDropdown) mount in tests.
      return (
        <div data-testid="reader-stub">
          {props.agentSlot as React.ReactNode}
        </div>
      );
    };
    return Stub;
  },
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

const agentTranscriptPropsRef: { value: Record<string, unknown> | null } = {
  value: null,
};

vi.mock("@/components/agent/AgentTranscript", () => ({
  AgentTranscript: (props: Record<string, unknown>) => {
    agentTranscriptPropsRef.value = props;
    return <div data-testid="agent-transcript" />;
  },
}));

const pastThreadsPropsRef: { value: Record<string, unknown> | null } = {
  value: null,
};

vi.mock("@/components/agent/PastThreadsDropdown", () => ({
  PastThreadsDropdown: (props: Record<string, unknown>) => {
    pastThreadsPropsRef.value = props;
    return <div data-testid="past-threads-dropdown-stub" />;
  },
}));

const storeStateRef: {
  value: {
    panelOpen: boolean;
    mountPoint: string;
    activeThreadId: string | null;
  };
} = {
  value: {
    panelOpen: false,
    mountPoint: "reader-side-panel",
    activeThreadId: null,
  },
};

vi.mock("@/state/agent-ball", () => ({
  useAgentBallStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        ...storeStateRef.value,
        openInReader: () => {},
        close: () => {},
      }),
    {
      getState: () => ({
        activeThreadId: storeStateRef.value.activeThreadId,
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
  pastThreadsPropsRef.value = null;
  agentTranscriptPropsRef.value = null;
  storeStateRef.value = {
    panelOpen: false,
    mountPoint: "reader-side-panel",
    activeThreadId: null,
  };
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

describe("ReaderShell PastThreadsDropdown refresh signal (codex NEEDS-FIX)", () => {
  it("bumps refreshKey AFTER /invoke resolves so dropdown refetches post-stamp", async () => {
    // Activate the activeThreadId branch so <PastThreadsDropdown> renders.
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-existing",
    };

    // Gate the /invoke response so we can observe refreshKey BEFORE and AFTER.
    type ResolveFn = (r: Response) => void;
    const resolver: { fn: ResolveFn | null } = { fn: null };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agents/km/invoke")) {
        return new Promise<Response>((res) => {
          resolver.fn = res;
        });
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-refresh" />);

    await waitFor(() => {
      expect(pastThreadsPropsRef.value).not.toBeNull();
    });
    const initialKey = pastThreadsPropsRef.value?.refreshKey as number;
    expect(typeof initialKey).toBe("number");

    const onExplain = readerPropsRef.value?.onExplainPassage as (a: {
      page: number;
      text: string;
    }) => Promise<void>;

    // Fire /invoke — still pending.
    const explainPromise = onExplain({ page: 1, text: "x" });

    // While /invoke is pending, refreshKey MUST NOT have changed yet (otherwise
    // the dropdown would race the stamping write on the python side).
    await new Promise((r) => setTimeout(r, 10));
    expect(pastThreadsPropsRef.value?.refreshKey).toBe(initialKey);

    // Resolve /invoke. Now refreshKey should bump.
    resolver.fn?.(new Response("{}", { status: 200 }));
    await explainPromise;

    await waitFor(() => {
      expect(pastThreadsPropsRef.value?.refreshKey).toBe(initialKey + 1);
    });

    vi.unstubAllGlobals();
  });

  it("fetches /state and passes initialMessages to AgentTranscript on activeThreadId (N8)", async () => {
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-with-history",
    };

    const persisted = [
      { id: "m1", role: "user", text: "hi" },
      { id: "m2", role: "assistant", text: "hello back" },
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agents/km/state/tid-with-history")) {
        return new Response(
          JSON.stringify({ messages: persisted }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-hydrate" />);

    await waitFor(() => {
      expect(agentTranscriptPropsRef.value).not.toBeNull();
      expect(agentTranscriptPropsRef.value?.initialMessages).toEqual(persisted);
    });
    // State endpoint must have been hit for the active thread.
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("/api/agents/km/state/tid-with-history"),
      ),
    ).toBe(true);

    vi.unstubAllGlobals();
  });

  it("bumps refreshKey when AgentTranscript's onStreamDone fires (chat-send path)", async () => {
    // Reproduces the user's E2E bug: chat-input messages flow through
    // AgentTranscript.defaultSend, NOT through ReaderShell.handleExplainPassage,
    // so the dropdown never refetched after a chat send. ReaderShell must
    // subscribe to AgentTranscript via `onStreamDone` and bump the key from
    // there.
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-existing",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-stream-done" />);

    await waitFor(() => {
      expect(pastThreadsPropsRef.value).not.toBeNull();
      expect(agentTranscriptPropsRef.value).not.toBeNull();
    });
    const initialKey = pastThreadsPropsRef.value?.refreshKey as number;

    const onStreamDone = agentTranscriptPropsRef.value?.onStreamDone as
      | (() => void)
      | undefined;
    expect(typeof onStreamDone).toBe("function");

    onStreamDone?.();

    await waitFor(() => {
      expect(pastThreadsPropsRef.value?.refreshKey).toBe(initialKey + 1);
    });

    vi.unstubAllGlobals();
  });
});
