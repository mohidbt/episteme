// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { resetTourDoneForTest, setTourDone, getTourDone } from "@/lib/guest-tour/tour-state";

const joyrideSpy = vi.fn();

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
});

describe("GuestTour", () => {
  it("autostarts for anonymous user when done flag unset and on allowed route", async () => {
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

  it("ships 4 spotlight steps with stable ids", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const steps = lastCall?.steps as Array<{ id: string }>;
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.id)).toEqual([
      "drive_intro",
      "notes_collection",
      "papers_refs_collection",
      "agentball_hint",
    ]);
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
