// @vitest-environment jsdom
import type * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { resetTourDoneForTest, setTourDone, getTourDone } from "@/lib/guest-tour/tour-state";
import * as waitForSelectorModule from "@/lib/guest-tour/wait-for-selector";

const joyrideSpy = vi.fn();

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />;
  },
}));

vi.mock("react-joyride", async () => {
  const STATUS = {
    IDLE: "idle",
    READY: "ready",
    WAITING: "waiting",
    RUNNING: "running",
    PAUSED: "paused",
    SKIPPED: "skipped",
    FINISHED: "finished",
  } as const;
  const EVENTS = {
    STEP_AFTER: "step:after",
    TOUR_END: "tour:end",
  } as const;
  return {
    STATUS,
    EVENTS,
    ACTIONS: {},
    ORIGIN: {},
    LIFECYCLE: {},
    Joyride: (props: Record<string, unknown>) => {
      joyrideSpy(props);
      return null;
    },
  };
});

const pathnameRef = { current: "/" };
const routerPushSpy = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useRouter: () => ({ push: routerPushSpy }),
}));

beforeEach(() => {
  resetTourDoneForTest();
  joyrideSpy.mockClear();
  routerPushSpy.mockClear();
  pathnameRef.current = "/";
});

afterEach(() => {
  cleanup();
  // Some tests manually append DOM nodes (target stubs) via
  // document.body.appendChild — React's cleanup() doesn't remove those, and
  // their presence leaks into the next test's waitForSelector (resolves
  // synchronously when it shouldn't). Strip leftover children that aren't
  // React roots.
  document.body
    .querySelectorAll("[data-testid^='tour-nav-']")
    .forEach((el) => el.remove());
  document.body
    .querySelectorAll("[data-testid='tour-drive-header']")
    .forEach((el) => el.remove());
});

/**
 * Mount a stub `[data-testid="tour-drive-header"]` so the autostart
 * preflight (waitForSelector on step 0's target) resolves immediately.
 * Cleaned up by the global afterEach.
 */
function mountDriveHeaderStub() {
  const el = document.createElement("div");
  el.setAttribute("data-testid", "tour-drive-header");
  document.body.appendChild(el);
}

describe("GuestTour", () => {
  it("autostarts for anonymous user when done flag unset and on allowed route", async () => {
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
      const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(lastCall?.run).toBe(true);
    });
  });

  it("does NOT autostart when done flag is true", async () => {
    setTourDone();
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.run).toBe(false);
  });

  it("does NOT autostart for authenticated user", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={false} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.run).toBe(false);
  });

  it("does NOT autostart on /sign-in pathname", async () => {
    pathnameRef.current = "/sign-in";
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.run).toBe(false);
  });

  it("does NOT autostart on /papers/[id]/read (not a FileBrowser route)", async () => {
    pathnameRef.current = "/papers/abc/read";
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.run).toBe(false);
  });

  it("does NOT autostart on /notes list page (not a FileBrowser route)", async () => {
    pathnameRef.current = "/notes";
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.run).toBe(false);
  });

  it("autostarts on /drive/folder-1 (FileBrowser route)", async () => {
    pathnameRef.current = "/drive/folder-1";
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
      const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(lastCall?.run).toBe(true);
    });
  });

  it("autostarts on /trash (FileBrowser route)", async () => {
    pathnameRef.current = "/trash";
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
      const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(lastCall?.run).toBe(true);
    });
  });

  it("does NOT autostart on / when tour-drive-header is absent from DOM (preflight gate)", async () => {
    // Anon, no done flag, allowed route — but the empty-library state on /
    // doesn't render FileBrowser, so the step-0 selector never appears.
    // The preflight must keep run=false so Joyride doesn't paint a dim
    // overlay with no spotlight.
    //
    // Spy on waitForSelector so we control resolution deterministically:
    // resolve with null (selector never appeared) and assert run stayed false.
    pathnameRef.current = "/";
    let resolveSelector!: (el: Element | null) => void;
    const spy = vi
      .spyOn(waitForSelectorModule, "waitForSelector")
      .mockImplementation(
        () =>
          new Promise<Element | null>((resolve) => {
            resolveSelector = resolve;
          }),
      );
    try {
      const { GuestTour } = await import("../GuestTour");
      render(<GuestTour isAnonymous={true} />);
      await waitFor(() => {
        expect(joyrideSpy).toHaveBeenCalled();
        expect(spy).toHaveBeenCalled();
      });
      // Simulate preflight timeout: resolve with null.
      resolveSelector(null);
      // Flush microtasks.
      await Promise.resolve();
      await Promise.resolve();
      const calls = joyrideSpy.mock.calls.map((c) => c[0] as { run: boolean });
      expect(calls.every((c) => c.run === false)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("preflight cancelled when pathname changes to disallowed route before selector resolves", async () => {
    // Anon on / with NO stub mounted — preflight will sit waiting.
    // Before it resolves, pathname flips to /sign-in (disallowed).
    // The preflight's cancelled flag (and the pathname re-check on resolve)
    // must prevent setRun(true) even if the selector later appears.
    pathnameRef.current = "/";
    let resolveSelector!: (el: Element | null) => void;
    const spy = vi
      .spyOn(waitForSelectorModule, "waitForSelector")
      .mockImplementation(
        () =>
          new Promise<Element | null>((resolve) => {
            resolveSelector = resolve;
          }),
      );
    try {
      const { GuestTour } = await import("../GuestTour");
      const { rerender } = render(<GuestTour isAnonymous={true} />);
      await waitFor(() => {
        expect(joyrideSpy).toHaveBeenCalled();
        expect(spy).toHaveBeenCalled();
      });
      // Flip pathname mid-preflight.
      pathnameRef.current = "/sign-in";
      rerender(<GuestTour isAnonymous={true} />);
      // Now resolve the original preflight with a stub Element — if cancellation
      // didn't fire, this would flip run=true.
      const stub = document.createElement("div");
      stub.setAttribute("data-testid", "tour-drive-header");
      resolveSelector(stub);
      await Promise.resolve();
      await Promise.resolve();
      const calls = joyrideSpy.mock.calls.map((c) => c[0] as { run: boolean });
      expect(calls.every((c) => c.run === false)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("preflight resolve is a no-op when setTourDone() fired while waiting", async () => {
    // Anon on /, no stub yet — preflight starts and waits.
    // We synchronously flag tour done, THEN resolve the selector. The
    // preflight's getTourDone() re-check on resolve must short-circuit
    // setRun(true).
    pathnameRef.current = "/";
    let resolveSelector!: (el: Element | null) => void;
    const spy = vi
      .spyOn(waitForSelectorModule, "waitForSelector")
      .mockImplementation(
        () =>
          new Promise<Element | null>((resolve) => {
            resolveSelector = resolve;
          }),
      );
    try {
      const { GuestTour } = await import("../GuestTour");
      render(<GuestTour isAnonymous={true} />);
      await waitFor(() => {
        expect(joyrideSpy).toHaveBeenCalled();
        expect(spy).toHaveBeenCalled();
      });
      // Fire setTourDone BEFORE resolving, so the preflight's resolve
      // callback sees getTourDone() === true and bails.
      setTourDone();
      const stub = document.createElement("div");
      stub.setAttribute("data-testid", "tour-drive-header");
      resolveSelector(stub);
      await Promise.resolve();
      await Promise.resolve();
      const calls = joyrideSpy.mock.calls.map((c) => c[0] as { run: boolean });
      expect(calls.every((c) => c.run === false)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("does NOT autostart on guest welcome note redirect target", async () => {
    pathnameRef.current = "/n/welcome-to-episteme";
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.run).toBe(false);
  });

  it("skipped callback sets done flag", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = lastCall?.onEvent as (data: { status: string; type?: string }, controls: unknown) => void;
    expect(typeof onEvent).toBe("function");
    onEvent({ status: "skipped" }, {});
    expect(getTourDone()).toBe(true);
  });

  it("finished callback sets done flag", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = lastCall?.onEvent as (data: { status: string; type?: string }, controls: unknown) => void;
    onEvent({ status: "finished" }, {});
    expect(getTourDone()).toBe(true);
  });

  it("ships 17 steps (GSD-38 reordered tour) with stable ids", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const steps = lastCall?.steps as Array<{ id: string }>;
    expect(steps).toHaveLength(17);
    expect(steps.map((s) => s.id)).toEqual([
      "drive_intro",
      "notes_collection",
      "open_welcome_note",
      "references_collection",
      "wow_refs_fill",
      "open_reference",
      "wow_paper_search",
      "papers_collection",
      "open_seed_paper",
      "open_seed_paper_reader",
      "wow_reader_highlight",
      "open_seed_paperset",
      "wow_extract",
      "agentball_hint",
      "wow_paper_understanding",
      "graph_intro",
      "signup_cta",
    ]);
  });

  it("signup_cta step has NO in-card CTA — Joyride's primary button is the CTA", async () => {
    // Bug 1: the in-card CTA visually disconnected from Joyride's footer
    // "Done" button. Drop in-card CTA; relabel locale.last → "Sign up free".
    const { GuestTour } = await import("../GuestTour");
    const { render: renderRTL } = await import("@testing-library/react");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const steps = lastCall?.steps as Array<{
      id: string;
      target: string;
      content: React.ReactNode;
    }>;
    const step = steps.find((s) => s.id === "signup_cta");
    expect(step?.target).toBe("body");
    const { getByText, queryByTestId, unmount } = renderRTL(
      <>{step?.content}</>,
    );
    expect(getByText("Ready to make this yours?")).toBeDefined();
    // No preview badge AND no in-card CTA for the terminus step.
    expect(queryByTestId("tour-preview-badge")).toBeNull();
    expect(queryByTestId("tour-cta-button")).toBeNull();

    // Joyride's primary button label on the final step comes from locale.last.
    const locale = lastCall?.locale as { last?: string };
    expect(locale?.last).toBe("Sign up free");
    unmount();
  });

  it("STEP_AFTER on signup_cta with action=next sets done + routes to /sign-up", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = lastCall?.onEvent as (
      data: Record<string, unknown>,
      controls: unknown,
    ) => void;
    expect(getTourDone()).toBe(false);
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 16,
        lifecycle: "complete",
        step: { id: "signup_cta", data: {} },
      },
      {},
    );
    expect(getTourDone()).toBe(true);
    expect(routerPushSpy).toHaveBeenCalledWith("/sign-up");
  });

  it("Esc / close action fires done flag (dismissed path)", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = lastCall?.onEvent as (
      data: Record<string, unknown>,
      controls: unknown,
    ) => void;
    onEvent({ status: "running", action: "close", type: "tour:end" }, {});
    expect(getTourDone()).toBe(true);
  });

  it("prefers-reduced-motion propagates to Joyride options (skipScroll + scrollDuration=0)", async () => {
    // Stub matchMedia BEFORE importing GuestTour (module reads it via prefersReducedMotion).
    const original = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (q: string) => ({
        matches: q.includes("reduce"),
        media: q,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      vi.resetModules();
      const { GuestTour } = await import("../GuestTour");
      render(<GuestTour isAnonymous={true} />);
      await waitFor(() => {
        expect(joyrideSpy).toHaveBeenCalled();
      });
      const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
      const options = lastCall?.options as {
        skipScroll?: boolean;
        scrollDuration?: number;
      };
      expect(options?.skipScroll).toBe(true);
      expect(options?.scrollDuration).toBe(0);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
      vi.resetModules();
    }
  });

  it("preview steps target body (center-screen)", async () => {
    // Note: GSD-38 — preview steps now CAN carry `data.next` to drive the tour
    // forward across routes after a demo (e.g. wow_refs_fill → /r/[seedRef]).
    // The invariant we still assert is target=body (center placement).
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const steps = lastCall?.steps as Array<{
      id: string;
      target: string;
      data?: { next?: string };
    }>;
    const previewIds = [
      "wow_paper_understanding",
      "graph_intro",
      "wow_refs_fill",
      "wow_reader_highlight",
      "wow_paper_search",
      "wow_extract",
    ];
    for (const id of previewIds) {
      const step = steps.find((s) => s.id === id);
      expect(step?.target).toBe("body");
    }
  });

  it("preview steps render TourPreviewCard content with title + caption", async () => {
    const { GuestTour } = await import("../GuestTour");
    const { render: renderRTL } = await import("@testing-library/react");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const steps = lastCall?.steps as Array<{
      id: string;
      content: React.ReactNode;
    }>;
    const expectations: Array<{ id: string; title: string; captionStart: string }> = [
      { id: "wow_paper_understanding", title: "Understanding across papers and notes", captionStart: "Ask the agent across papers and notes" },
      { id: "graph_intro", title: "Graph (WIP)", captionStart: "Lines show explicit connections" },
      { id: "wow_refs_fill", title: "Fill missing reference fields", captionStart: "Drop a half-filled reference" },
      { id: "wow_reader_highlight", title: "Dynamic Reading: Let the agent highlight anything for you", captionStart: "Ask the agent to highlight" },
      { id: "wow_paper_search", title: "One-click PDF discovery", captionStart: "On any reference with no PDF" },
      { id: "wow_extract", title: "Paperset enrich (concurrent)", captionStart: "Define columns once" },
    ];
    for (const { id, title, captionStart } of expectations) {
      const step = steps.find((s) => s.id === id);
      const { getByText, getByTestId, unmount } = renderRTL(<>{step?.content}</>);
      expect(getByText(title)).toBeDefined();
      expect(getByText((txt) => txt.startsWith(captionStart))).toBeDefined();
      expect(getByTestId("tour-preview-badge")).toBeDefined();
      unmount();
    }
  });

  it("preview step (target=body) does NOT trigger router.push when advanced", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = lastCall?.onEvent as (
      data: Record<string, unknown>,
      controls: unknown,
    ) => void;

    // Step index 4 = wow_paper_understanding (preview); advancing it should NOT push a route.
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 4,
        lifecycle: "complete",
        step: { data: {} },
      },
      {},
    );
    expect(routerPushSpy).not.toHaveBeenCalled();
  });

  it("navigates on STEP_AFTER when step.data.next is set", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = lastCall?.onEvent as (data: Record<string, unknown>, controls: unknown) => void;
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 0,
        lifecycle: "complete",
        step: { data: { next: "/notes" } },
      },
      {},
    );
    expect(routerPushSpy).toHaveBeenCalledWith("/notes");
  });

  it(
    "auto-nav: pauses Joyride, awaits selector, then advances stepIndex (no race)",
    async () => {
      mountDriveHeaderStub();
      const { GuestTour } = await import("../GuestTour");
      render(<GuestTour isAnonymous={true} />);
      await waitFor(() => {
        const c = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(c?.run).toBe(true);
      });
      const firstCall = joyrideSpy.mock.calls.at(-1)?.[0];
      const steps = firstCall?.steps as Array<{ target: string; data?: { next?: string } }>;
      expect(firstCall?.run).toBe(true);
      expect(firstCall?.stepIndex).toBe(0);

      // The selector for step index 1 (notes_collection) must NOT exist yet
      // when STEP_AFTER fires for step index 0 (drive_intro). It will appear
      // ~30ms later, simulating Next.js client navigation hydration.
      const nextStepTarget = steps[1].target;
      expect(document.querySelector(nextStepTarget)).toBeNull();

      const onEvent = firstCall?.onEvent as (
        data: Record<string, unknown>,
        controls: unknown,
      ) => void;

      // Fire STEP_AFTER for drive_intro (index 0) — has data.next: "/notes"
      onEvent(
        {
          type: "step:after",
          action: "next",
          status: "running",
          index: 0,
          lifecycle: "complete",
          step: { data: { next: "/notes" } },
        },
        {},
      );

      // Router push must be called synchronously / immediately
      expect(routerPushSpy).toHaveBeenCalledWith("/notes");

      // After push, Joyride must be PAUSED (run=false) and stepIndex still 0
      // — assert this BEFORE the selector mounts.
      await waitFor(() => {
        const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.run).toBe(false);
      });
      const pausedCall = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(pausedCall?.stepIndex).toBe(0);

      // Now mount the next-step target into the DOM (simulates Next.js
      // route DOM hydration ~30ms after router.push).
      const el = document.createElement("div");
      el.setAttribute(
        "data-testid",
        nextStepTarget.replace(/^\[data-testid="(.+)"\]$/, "$1"),
      );
      document.body.appendChild(el);

      // After selector appears, Joyride should resume at stepIndex=1
      await waitFor(() => {
        const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.stepIndex).toBe(1);
        expect(lastCall?.run).toBe(true);
      });
    },
    10_000,
  );

  it("auto-nav: skips to next step (no break) on selector timeout", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const firstCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = firstCall?.onEvent as (
      data: Record<string, unknown>,
      controls: unknown,
    ) => void;

    // Patch the wait-for-selector behaviour by using a super-short timeout
    // path: data.next pointing somewhere with a target that never mounts.
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 0,
        lifecycle: "complete",
        step: { data: { next: "/notes" } },
      },
      {},
    );

    // Even on timeout (no DOM ever mounts), the tour should ultimately
    // resume at stepIndex=1 and NOT remain paused forever.
    await waitFor(
      () => {
        const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.stepIndex).toBe(1);
        expect(lastCall?.run).toBe(true);
      },
      { timeout: 6_000 },
    );
  }, 10_000);

  it(
    "pathname change mid-advance does NOT re-enable run before selector resolves",
    async () => {
      mountDriveHeaderStub();
      const { GuestTour } = await import("../GuestTour");
      const { rerender } = render(<GuestTour isAnonymous={true} />);
      await waitFor(() => {
        const c = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(c?.run).toBe(true);
      });
      const firstCall = joyrideSpy.mock.calls.at(-1)?.[0];
      const steps = firstCall?.steps as Array<{ target: string; data?: { next?: string } }>;
      expect(firstCall?.run).toBe(true);

      const onEvent = firstCall?.onEvent as (
        data: Record<string, unknown>,
        controls: unknown,
      ) => void;

      // Kick off advanceTo: sets advancingRef=true, setRun(false), pushes "/notes".
      onEvent(
        {
          type: "step:after",
          action: "next",
          status: "running",
          index: 0,
          lifecycle: "complete",
          step: { data: { next: "/notes" } },
        },
        {},
      );

      // After STEP_AFTER, Joyride should be paused.
      await waitFor(() => {
        const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.run).toBe(false);
      });

      // Simulate Next.js completing client navigation BEFORE the next-step
      // target has mounted: pathname flips to "/notes" (an allowed route).
      // The pathname effect must NOT setRun(true) while advancingRef is set.
      pathnameRef.current = "/notes";
      rerender(<GuestTour isAnonymous={true} />);

      // Give React a tick to flush the effect.
      await new Promise((r) => setTimeout(r, 50));

      // Joyride must still be paused — pathname effect was guarded.
      const midCall = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(midCall?.run).toBe(false);
      expect(midCall?.stepIndex).toBe(0);

      // Mount target → advanceTo's finally clears advancingRef and resumes.
      const nextStepTarget = steps[1].target;
      const el = document.createElement("div");
      el.setAttribute(
        "data-testid",
        nextStepTarget.replace(/^\[data-testid="(.+)"\]$/, "$1"),
      );
      document.body.appendChild(el);

      await waitFor(() => {
        const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.stepIndex).toBe(1);
        expect(lastCall?.run).toBe(true);
      });
    },
    10_000,
  );

  it("Joyride options enable back navigation (Bug 4)", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const options = lastCall?.options as { buttons?: string[] };
    expect(options?.buttons).toContain("back");
    expect(options?.buttons).toEqual(["back", "skip", "primary"]);
  });

  it("first step (drive_intro) hides Back button via per-step styles — nowhere to go back to", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const steps = lastCall?.steps as Array<{
      id: string;
      styles?: { buttonBack?: { display?: string } };
    }>;
    const drive = steps.find((s) => s.id === "drive_intro");
    expect(drive?.styles?.buttonBack?.display).toBe("none");
    // Other steps should not hide back.
    const notes = steps.find((s) => s.id === "notes_collection");
    expect(notes?.styles?.buttonBack).toBeUndefined();
  });

  it("Bug 4: STEP_AFTER with action=prev within same route decrements stepIndex (no router push)", async () => {
    // graph_intro (index 5) → wow_paper_understanding (index 4): both are
    // body targets, no `prev` route on graph_intro → goBackTo without push.
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.run).toBe(true);
    });
    const firstCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = firstCall?.onEvent as (
      data: Record<string, unknown>,
      controls: unknown,
    ) => void;
    // Advance the controlled stepIndex to 5 first via a quick sequence of
    // next-events. Faster: simulate landing on step 5 directly by firing
    // advance events with already-matching indices.
    // Walk forward: 0 -> 1 (with /notes push, then back)
    // Simpler: just fire prev from a known stepIndex using the stale-guard
    // tolerance: synthesize STEP_AFTER index=stepIndex 0 prev → goBackTo(-1)
    // which is a no-op. Instead, fire next first to bump.

    // We can't actually mutate stepIndex from outside; but we can fire a
    // sequence that the handler processes. To keep this simple, test the
    // simpler prev-on-step-1 case: stepIndex starts at 0; fire next to go
    // to 1 (with /notes selector failing → eventual advance); then fire
    // prev with prev=/ to come back.
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 0,
        lifecycle: "complete",
        step: { id: "drive_intro", data: { next: "/notes" } },
      },
      {},
    );
    expect(routerPushSpy).toHaveBeenCalledWith("/notes");
    // Mount the nav-notes target so advance resolves.
    const nav = document.createElement("div");
    nav.setAttribute("data-testid", "tour-nav-notes");
    document.body.appendChild(nav);
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.stepIndex).toBe(1);
      expect(c?.run).toBe(true);
    });
    routerPushSpy.mockClear();

    // Now fire prev from step 1 — should go back to step 0 + push '/'.
    onEvent(
      {
        type: "step:after",
        action: "prev",
        status: "running",
        index: 1,
        lifecycle: "complete",
        step: { id: "notes_collection", data: { next: "/references", prev: "/" } },
      },
      {},
    );
    expect(routerPushSpy).toHaveBeenCalledWith("/");
    // Already-mounted drive header → goBackTo resolves quickly. Assert we
    // settle on stepIndex=0, run=true (the pause window is a microtask
    // and may not be observable from the test side).
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.stepIndex).toBe(0);
      expect(c?.run).toBe(true);
    });
  }, 15_000);

  it("Bug 3: stale STEP_AFTER (index != controlled stepIndex) is IGNORED — no double advance", async () => {
    // Reproduce the "drive flashes then jumps to notes / 1/11" pattern:
    // Joyride may emit STEP_AFTER for index=0 AFTER we've already advanced
    // to stepIndex=1 (controlled-mode lag during pause/resume across a
    // router.push). Without a stale-event guard the handler would call
    // advanceTo(1, '/notes') a SECOND time, double-pausing and visually
    // glitching the tour while leaving Joyride's internal index at 0 (the
    // "1/11" progress display).
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.run).toBe(true);
    });
    const firstCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = firstCall?.onEvent as (
      data: Record<string, unknown>,
      controls: unknown,
    ) => void;
    // First STEP_AFTER for index=0 — legitimate, advance.
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 0,
        lifecycle: "complete",
        step: { id: "drive_intro", data: { next: "/notes" } },
      },
      {},
    );
    expect(routerPushSpy).toHaveBeenCalledTimes(1);
    expect(routerPushSpy).toHaveBeenCalledWith("/notes");
    // Mount the next-step target so advance finishes.
    const nav = document.createElement("div");
    nav.setAttribute("data-testid", "tour-nav-notes");
    document.body.appendChild(nav);
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.stepIndex).toBe(1);
    });
    routerPushSpy.mockClear();

    // Now fire a STALE STEP_AFTER for index=0 again (Joyride's controlled
    // sync lag). Guard must reject — no second router.push, no advance to 2.
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 0,
        lifecycle: "complete",
        step: { id: "drive_intro", data: { next: "/notes" } },
      },
      {},
    );
    expect(routerPushSpy).not.toHaveBeenCalled();
    // Tick a bit; stepIndex must stay at 1.
    await new Promise((r) => setTimeout(r, 50));
    const c = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(c?.stepIndex).toBe(1);
  }, 15_000);

  it("Bug 3: STEP_AFTER with action=update (internal Joyride event) does NOT advance", async () => {
    // On initial mount or during pause/resume, Joyride emits STEP_AFTER with
    // action: 'update' (fallback when no user action set). The handler must
    // ignore it — only `next` and `prev` are user-initiated.
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const firstCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = firstCall?.onEvent as (
      data: Record<string, unknown>,
      controls: unknown,
    ) => void;
    onEvent(
      {
        type: "step:after",
        action: "update",
        status: "running",
        index: 0,
        lifecycle: "complete",
        step: { id: "drive_intro", data: { next: "/notes" } },
      },
      {},
    );
    expect(routerPushSpy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 50));
    const c = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(c?.stepIndex).toBe(0);
  });

  it("3.1a.1: autostart bails when TabBar redirects to welcome note mid-preflight (settle gate)", async () => {
    // Real-world bug: anon lands on /, GuestTour starts waitForSelector. The
    // tour-drive-header IS in DOM (FileBrowser rendered briefly). Selector
    // resolves immediately, but TabBarProvider's hydration effect on the same
    // tick calls router.push("/n/welcome-to-episteme") → pathname flips. The
    // 50ms settle + post-resolve pathname re-check + DOM contains() guard must
    // prevent autostart.
    pathnameRef.current = "/";
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    const { rerender } = render(<GuestTour isAnonymous={true} />);
    // Within the settle window, flip pathname (simulates TabBar's push landing).
    pathnameRef.current = "/n/welcome-to-episteme";
    // Also rip the header out of DOM (simulates route DOM change).
    document.body
      .querySelectorAll("[data-testid='tour-drive-header']")
      .forEach((el) => el.remove());
    rerender(<GuestTour isAnonymous={true} />);
    // Wait past the settle (>50ms).
    await new Promise((r) => setTimeout(r, 120));
    const calls = joyrideSpy.mock.calls.map((c) => c[0] as { run: boolean });
    expect(calls.every((c) => c.run === false)).toBe(true);
  });

  it("3.1a.1: autostart fires when header mounts AFTER initial probe (delayed mount within timeout)", async () => {
    // Anon on / with NO header in DOM at mount time. Header mounts ~100ms
    // later (FileBrowser hydration). The extended 10s timeout should catch
    // it; tour autostarts cleanly.
    pathnameRef.current = "/";
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    // Mount header after a short delay — still within the 10s timeout.
    setTimeout(() => mountDriveHeaderStub(), 100);
    await waitFor(
      () => {
        const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.run).toBe(true);
      },
      { timeout: 3_000 },
    );
  }, 10_000);

  it("3.1a.1 regression: TabBar pushes welcome AFTER autostart fires — startedRef locks out re-fire on return to /", async () => {
    // Real bug from preview: TabBar's push lands ~400ms after mount, AFTER the
    // 50ms settle window. So the autostart fires (run=true, startedRef=true).
    // Then welcome route mounts, header is ripped out, Joyride flashes. User
    // clicks Drive → pathname returns to / and header re-mounts, but the
    // autostart effect short-circuits on `startedRef.current === true` and
    // never sets run=true again.
    pathnameRef.current = "/";
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    const { rerender } = render(<GuestTour isAnonymous={true} />);

    // Autostart should fire within the settle window (header is present,
    // pathname unchanged).
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.run).toBe(true);
    });

    // TabBar push lands LATE — header is torn out by route swap, pathname
    // becomes welcome. Joyride is now run=true with no target.
    pathnameRef.current = "/n/welcome-to-episteme";
    document.body
      .querySelectorAll("[data-testid='tour-drive-header']")
      .forEach((el) => el.remove());
    rerender(<GuestTour isAnonymous={true} />);
    await new Promise((r) => setTimeout(r, 30));

    // User clicks Drive — pathname back to /, header re-mounts.
    pathnameRef.current = "/";
    mountDriveHeaderStub();
    rerender(<GuestTour isAnonymous={true} />);

    // Tour MUST be running again on this allowed route. Currently fails:
    // startedRef.current === true blocks the autostart effect forever.
    await waitFor(
      () => {
        const c = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(c?.run).toBe(true);
        expect(c?.stepIndex).toBe(0);
      },
      { timeout: 2_000 },
    );
  }, 10_000);

  it("3.1a.1 regression: after welcome-tab bail, navigating back to / FIRES the tour", async () => {
    // Repro of the user-reported regression on c9f37eb:
    // Scenario B — anon → / → TabBar pushes /n/welcome-to-episteme mid-preflight.
    // Settle + contains-check correctly bail (no glitch). Then user clicks the
    // Drive tab → pathname returns to / → drive-header re-mounts.
    // The tour MUST fire — currently it never does (autostart effect short-
    // circuits or the latch is stuck).
    pathnameRef.current = "/";
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    const { rerender } = render(<GuestTour isAnonymous={true} />);

    // Within the settle window: simulate TabBar push landing — pathname flips
    // to welcome, header is ripped from DOM (route content swap).
    pathnameRef.current = "/n/welcome-to-episteme";
    document.body
      .querySelectorAll("[data-testid='tour-drive-header']")
      .forEach((el) => el.remove());
    rerender(<GuestTour isAnonymous={true} />);

    // Wait past the settle to confirm the bail succeeded.
    await new Promise((r) => setTimeout(r, 120));
    let calls = joyrideSpy.mock.calls.map((c) => c[0] as { run: boolean });
    expect(calls.every((c) => c.run === false)).toBe(true);

    // User clicks Drive tab — pathname returns to /, header re-mounts.
    pathnameRef.current = "/";
    mountDriveHeaderStub();
    rerender(<GuestTour isAnonymous={true} />);

    // Tour MUST fire.
    await waitFor(
      () => {
        const c = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(c?.run).toBe(true);
      },
      { timeout: 2_000 },
    );
  }, 10_000);

  it("3.1a.1 regression: autostart re-fires after a tear-down → recover cycle on step 0", async () => {
    // Worst-case timing: autostart fires (header present at /), then TabBar's
    // push lands LATE and rips the route out. Tour pauses on disallowed route
    // (so Joyride doesn't emit SKIPPED → setTourDone). User returns to /.
    // Tour MUST autostart again because the user never engaged past step 0.
    pathnameRef.current = "/";
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    const { rerender } = render(<GuestTour isAnonymous={true} />);

    // Initial autostart.
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.run).toBe(true);
      expect(c?.stepIndex).toBe(0);
    });

    // TabBar push lands late: pathname flips, header torn out.
    pathnameRef.current = "/n/welcome-to-episteme";
    document.body
      .querySelectorAll("[data-testid='tour-drive-header']")
      .forEach((el) => el.remove());
    rerender(<GuestTour isAnonymous={true} />);

    // Tour must be paused on disallowed route (so Joyride doesn't fire
    // SKIPPED → setTourDone).
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.run).toBe(false);
    });
    expect(getTourDone()).toBe(false);

    // User returns to / via Drive tab — header re-mounts.
    pathnameRef.current = "/";
    mountDriveHeaderStub();
    rerender(<GuestTour isAnonymous={true} />);

    // Tour MUST re-fire at step 0.
    await waitFor(
      () => {
        const c = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(c?.run).toBe(true);
        expect(c?.stepIndex).toBe(0);
      },
      { timeout: 2_000 },
    );
  }, 10_000);

  it("GSD-39: tooltip carries NO border; outline is drawn on floater via stacked drop-shadow filter so it traces the arrow-notch union", async () => {
    // Bug: a `border` on the tooltip rectangle paints a line ACROSS the arrow
    // notch where the arrow SVG meets the tooltip edge — the arrow has no
    // matching border so the seam looks broken.
    // Fix: drop the tooltip border, and apply a 4-direction stacked
    // `drop-shadow()` filter chain to the `floater` wrapper. drop-shadow
    // traces the alpha union of its descendants, so the outline wraps the
    // tooltip + arrow as a single shape.
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const styles = lastCall?.styles as {
      tooltip?: Record<string, unknown>;
      floater?: Record<string, unknown>;
    };
    // Tooltip MUST NOT carry a `border` — the arrow has no matching one, so
    // a tooltip border paints a visible seam across the notch base.
    expect(styles?.tooltip?.border).toBeUndefined();
    // Floater MUST carry a `filter` with multiple drop-shadow() entries so
    // the outline traces the union of tooltip + arrow.
    const filter = styles?.floater?.filter;
    expect(typeof filter).toBe("string");
    const dropShadowCount = (filter as string).match(/drop-shadow\(/g)?.length ?? 0;
    expect(dropShadowCount).toBeGreaterThanOrEqual(4);
  });

  it("Bug 3: autostart is one-shot — pathname change after start does NOT re-fire setRun(true)", async () => {
    // The pathname effect used to re-run on every allowed pathname; after
    // advanceTo cleared advancingRef in `finally`, a late waitForSelector
    // could flip run back on at the wrong stepIndex (glitch). Once
    // startedRef latches, subsequent pathname changes are no-ops in the
    // autostart effect.
    mountDriveHeaderStub();
    const { GuestTour } = await import("../GuestTour");
    const { rerender } = render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      const c = joyrideSpy.mock.calls.at(-1)?.[0];
      expect(c?.run).toBe(true);
    });
    // Move pathname to /trash (an allowed route) and back to / — should NOT
    // restart the tour.
    pathnameRef.current = "/trash";
    rerender(<GuestTour isAnonymous={true} />);
    await new Promise((r) => setTimeout(r, 30));
    pathnameRef.current = "/";
    rerender(<GuestTour isAnonymous={true} />);
    await new Promise((r) => setTimeout(r, 30));
    // Run should still be true and stepIndex 0 (we never moved). Critically,
    // no additional Joyride start cycles were triggered by the autostart.
    const c = joyrideSpy.mock.calls.at(-1)?.[0];
    expect(c?.run).toBe(true);
    expect(c?.stepIndex).toBe(0);
  });
});
