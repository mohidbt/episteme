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
        step: { data: { next: "/notes" } },
      },
      {},
    );
    expect(routerPushSpy).toHaveBeenCalledWith("/notes");
  });
});
