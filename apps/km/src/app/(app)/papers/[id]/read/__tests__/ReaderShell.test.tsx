// @vitest-environment jsdom
import type React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor, screen, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

// Run a callback inside act() and flush the resulting microtasks. Used to
// drive React state updates from a raw handler invocation in tests.
async function actAsync(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

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

// Records every setActiveThread(id) call so tests can assert what the reader
// restored/created. Reset in afterEach.
const setActiveThreadSpy = vi.fn((id: string | null) => {
  storeStateRef.value.activeThreadId = id;
});

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
        setActiveThread: setActiveThreadSpy,
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
  setActiveThreadSpy.mockClear();
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
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
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

  it("does NOT mount AgentTranscript while /state is in flight (N8 codex follow-up)", async () => {
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-pending",
    };

    // Gate /state so it never resolves during the assertion window.
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agents/km/state/")) {
        return new Promise<Response>(() => {
          /* never resolves */
        });
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-pending" />);

    // Past-threads dropdown sits next to the skeleton — it should mount even
    // while we're waiting on /state.
    await waitFor(() => {
      expect(pastThreadsPropsRef.value).not.toBeNull();
    });
    // AgentTranscript must NOT have mounted yet — its useReducer initializer
    // runs once on mount and would freeze in the empty state.
    expect(agentTranscriptPropsRef.value).toBeNull();

    vi.unstubAllGlobals();
  });

  it("URL-encodes the threadId in the /state fetch (N8 codex follow-up)", async () => {
    const weirdId = "tid with/slash";
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: weirdId,
    };

    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="p-encode" />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) =>
          String(c[0]).includes(
            `/api/agents/km/state/${encodeURIComponent(weirdId)}`,
          ),
        ),
      ).toBe(true);
    });
    // The raw id (containing a slash) must NOT appear in the URL.
    expect(
      fetchMock.mock.calls.some((c) =>
        String(c[0]).includes(`/api/agents/km/state/${weirdId}`),
      ),
    ).toBe(false);

    vi.unstubAllGlobals();
  });

  it("mounts AgentTranscript with empty messages on /state fetch failure (N8 codex follow-up)", async () => {
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-fail",
    };

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agents/km/state/")) {
        return new Response("nope", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-fail" />);

    // On fetch failure we should still mount the transcript (with empty
    // messages) so the UI proceeds instead of hanging in the skeleton.
    await waitFor(() => {
      expect(agentTranscriptPropsRef.value).not.toBeNull();
      expect(agentTranscriptPropsRef.value?.initialMessages).toEqual([]);
    });

    vi.unstubAllGlobals();
  });

  it("restores the most-recent paper thread on reload instead of creating a fresh empty one (GSD-222)", async () => {
    // Reload: panel open (persisted mountPoint), but activeThreadId reset to
    // null because the zustand store is in-memory only. The paper HAS a prior
    // chat thread. The reader must RESTORE it — not POST a brand-new empty
    // thread — otherwise the prior history is orphaned and the transcript
    // rehydrates empty.
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: null,
    };

    const priorThreads = [
      { thread_id: "tid-recent", created_at: "2026-07-18T10:00:00Z", title: "recent chat" },
      { thread_id: "tid-older", created_at: "2026-07-17T10:00:00Z", title: "older chat" },
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agents/km/threads-for-paper/")) {
        return new Response(JSON.stringify({ threads: priorThreads }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-reload" />);

    // The reader must restore the MOST RECENT prior thread (threads[0]).
    await waitFor(() => {
      expect(setActiveThreadSpy).toHaveBeenCalledWith("tid-recent");
    });

    // It must NOT create a brand-new empty thread when a prior one exists.
    const createdNew = fetchMock.mock.calls.some(
      (c) =>
        String(c[0]).includes("/api/agent/threads") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(createdNew).toBe(false);

    vi.unstubAllGlobals();
  });

  it("creates a new thread on reload when the paper has NO prior threads (GSD-222)", async () => {
    // No prior chat on this paper → falling through to createThread() is the
    // correct behaviour; the empty-list restore path must not break it.
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: null,
    };

    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agents/km/threads-for-paper/")) {
        return new Response(JSON.stringify({ threads: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/agent/threads")) {
        return new Response(JSON.stringify({ thread: { threadId: "tid-fresh" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-no-prior" />);

    await waitFor(() => {
      expect(setActiveThreadSpy).toHaveBeenCalledWith("tid-fresh");
    });
    const createdNew = fetchMock.mock.calls.some(
      (c) =>
        String(c[0]).includes("/api/agent/threads") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(createdNew).toBe(true);

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

describe("ReaderShell new-thread control (GSD-222 bug a)", () => {
  it("renders a 'New chat' button when a thread is active", async () => {
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
    render(<ReaderShell paperId="paper-new-chat" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /new chat/i }),
      ).toBeTruthy();
    });

    vi.unstubAllGlobals();
  });

  it("POSTs a fresh thread and switches to it when 'New chat' is clicked", async () => {
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-old",
    };

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agent/threads") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ thread: { threadId: "tid-brand-new" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-new-chat-2" />);

    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /new chat/i }),
    );
    fireEvent.click(btn);

    await waitFor(() => {
      expect(setActiveThreadSpy).toHaveBeenCalledWith("tid-brand-new");
    });

    const createdNew = fetchMock.mock.calls.some(
      (c) =>
        String(c[0]).includes("/api/agent/threads") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(createdNew).toBe(true);

    vi.unstubAllGlobals();
  });

  it("re-enables 'New chat' after its in-flight POST is aborted/superseded (codex NEEDS-FIX)", async () => {
    // Reproduces the stuck-button bug: if the create-thread POST is aborted
    // (e.g. the user picks a past thread, or a second new-chat click) while
    // pending, `newThreadPending` must still reset — otherwise the button is
    // permanently disabled.
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-old",
    };

    // /api/agent/threads never resolves on its own; it only settles when its
    // AbortSignal fires (mirrors the real fetch reject-on-abort behaviour).
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agent/threads") && init?.method === "POST") {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }
        });
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-abort" />);

    const btn = await waitFor(() =>
      screen.getByRole("button", { name: /new chat/i }),
    );
    // Kick off the new-chat POST — button becomes disabled while pending.
    fireEvent.click(btn);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /new chat/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );

    // Supersede it (user picks a past thread) → aborts the in-flight controller.
    (pastThreadsPropsRef.value?.onSelect as ((id: string) => void) | undefined)?.(
      "tid-picked",
    );

    // The button MUST re-enable — not stay stuck disabled.
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /new chat/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );

    vi.unstubAllGlobals();
  });

  it("keeps 'New chat' disabled when a SUPERSEDED create resolves while a newer create is still pending (FINDING 3)", async () => {
    // The `disabled` attribute is only the UI-level guard; the pending-state
    // machine must ALSO be correct so a superseded invocation's `finally`
    // cannot re-enable the control while a newer create is still in flight
    // (which would let a third create spawn a duplicate thread). Drive the
    // handler directly (the button's onClick) to exercise the state machine:
    // invocation A, then invocation B (which aborts A and starts a new POST),
    // then resolve the SUPERSEDED A — the button must STAY disabled because B
    // is still pending.
    storeStateRef.value = {
      panelOpen: true,
      mountPoint: "reader-side-panel",
      activeThreadId: "tid-old",
    };

    const posts: Array<{
      resolve: (r: Response) => void;
      aborted: boolean;
    }> = [];
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/agent/threads") && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          const entry = { resolve, aborted: false };
          posts.push(entry);
          init?.signal?.addEventListener("abort", () => {
            entry.aborted = true;
          });
        });
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { ReaderShell } = await import("../ReaderShell");
    render(<ReaderShell paperId="paper-supersede" />);

    const liveBtn = () =>
      screen.getByRole("button", { name: /new chat/i }) as HTMLButtonElement;
    await waitFor(() => expect(liveBtn()).toBeTruthy());

    // Read the React onClick handler directly off the button's fiber props so
    // we can drive the pending-state machine independently of the DOM
    // `disabled` gate (which is only the first line of defense). This exercises
    // the guard the finding asks for: a superseded invocation must not clear
    // the pending flag that a newer invocation now owns.
    const clickHandler = (): (() => void) => {
      const btn = liveBtn();
      const key = Object.keys(btn).find((k) =>
        k.startsWith("__reactProps$"),
      );
      const props = (btn as unknown as Record<string, { onClick?: () => void }>)[
        key as string
      ];
      return props.onClick as () => void;
    };

    // Invocation A — POST A pending, button disabled.
    await actAsync(() => clickHandler()());
    await waitFor(() => expect(posts.length).toBe(1));
    await waitFor(() => expect(liveBtn().disabled).toBe(true));

    // Invocation B supersedes A (aborts A's controller, starts POST B).
    await actAsync(() => clickHandler()());
    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[0].aborted).toBe(true);

    // Resolve the SUPERSEDED invocation A. Its `finally` runs — but B is still
    // in flight, so the button must STAY disabled.
    posts[0].resolve(
      new Response(JSON.stringify({ thread: { threadId: "tid-A" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(liveBtn().disabled).toBe(true);
    // The superseded A must NOT have switched the active thread.
    expect(setActiveThreadSpy).not.toHaveBeenCalledWith("tid-A");

    vi.unstubAllGlobals();
  });
});
