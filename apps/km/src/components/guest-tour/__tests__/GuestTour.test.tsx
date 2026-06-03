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

  it("ships 10 steps (4 spotlights + 5 preview cards + signup_cta) with stable ids", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const steps = lastCall?.steps as Array<{ id: string }>;
    expect(steps).toHaveLength(10);
    expect(steps.map((s) => s.id)).toEqual([
      "drive_intro",
      "notes_collection",
      "papers_refs_collection",
      "agentball_hint",
      "graph_intro",
      "wow_refs_fill",
      "wow_reader_highlight",
      "wow_deepread",
      "wow_extract",
      "signup_cta",
    ]);
  });

  it("signup_cta step renders CTA button with correct href, and click fires setTourDone BEFORE navigation", async () => {
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
    const { getByTestId, getByText, queryByTestId, unmount } = renderRTL(
      <>{step?.content}</>,
    );
    expect(getByText("Ready to make this yours?")).toBeDefined();
    // No preview badge for the terminus step.
    expect(queryByTestId("tour-preview-badge")).toBeNull();
    const cta = getByTestId("tour-cta-button") as HTMLAnchorElement;
    expect(cta.getAttribute("href")).toBe("/sign-up");
    expect(cta.textContent).toContain("Sign up free");

    // Done flag must be set BEFORE the navigation (the link's default
    // navigation runs after onClick). Assert: clicking the CTA flips
    // localStorage to "true".
    expect(getTourDone()).toBe(false);
    cta.addEventListener("click", (e) => e.preventDefault(), true);
    cta.click();
    expect(getTourDone()).toBe(true);
    unmount();
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

  it("preview steps target body (center-screen, no router nav)", async () => {
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
      "graph_intro",
      "wow_refs_fill",
      "wow_reader_highlight",
      "wow_deepread",
      "wow_extract",
    ];
    for (const id of previewIds) {
      const step = steps.find((s) => s.id === id);
      expect(step?.target).toBe("body");
      expect(step?.data?.next).toBeUndefined();
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
      { id: "graph_intro", title: "Graph view", captionStart: "Lines are set connections" },
      { id: "wow_refs_fill", title: "Fill missing reference fields", captionStart: "Drop a half-filled BibTeX" },
      { id: "wow_reader_highlight", title: "Highlight numerical findings", captionStart: "Ask the agent to highlight" },
      { id: "wow_deepread", title: "Agentic PDF search", captionStart: "Ask one question" },
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

    // Step index 4 = graph_intro; advancing it should NOT push a route.
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
        expect(joyrideSpy).toHaveBeenCalled();
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
        expect(joyrideSpy).toHaveBeenCalled();
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

  it("Joyride options hide the back button (forward-only tour)", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const options = lastCall?.options as { buttons?: string[] };
    expect(options?.buttons).not.toContain("back");
    expect(options?.buttons).toEqual(["skip", "primary"]);
  });

  it("non-nav STEP_AFTER (no step.data.next) advances stepIndex synchronously", async () => {
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

    // Last step (agentball_hint, index 3) has no data.next. Simulate
    // STEP_AFTER for an earlier index without data.next: not realistic
    // for current step list, but the handler must still behave.
    onEvent(
      {
        type: "step:after",
        action: "next",
        status: "running",
        index: 2,
        lifecycle: "complete",
        step: { data: {} },
      },
      {},
    );
    expect(routerPushSpy).not.toHaveBeenCalled();
    // Even with no nav, advanceTo still awaits the next target selector
    // before flipping stepIndex (no-op cost for already-mounted DOM).
    // In the jsdom test world the target won't appear, so we accept the
    // selector timeout (4s) and assert eventual advance.
    await waitFor(
      () => {
        const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
        expect(lastCall?.stepIndex).toBe(3);
      },
      { timeout: 6_000 },
    );
  }, 10_000);
});
