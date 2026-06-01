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
  return {
    STATUS,
    ACTIONS: {},
    EVENTS: {},
    ORIGIN: {},
    LIFECYCLE: {},
    Joyride: (props: Record<string, unknown>) => {
      joyrideSpy(props);
      return null;
    },
  };
});

beforeEach(() => {
  resetTourDoneForTest();
  joyrideSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("GuestTour", () => {
  it("autostarts for anonymous user when done flag unset", async () => {
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

  it("skip/finish callback sets done flag", async () => {
    const { GuestTour } = await import("../GuestTour");
    render(<GuestTour isAnonymous={true} />);
    await waitFor(() => {
      expect(joyrideSpy).toHaveBeenCalled();
    });
    const lastCall = joyrideSpy.mock.calls.at(-1)?.[0];
    const onEvent = lastCall?.onEvent as (data: { status: string }, controls: unknown) => void;
    expect(typeof onEvent).toBe("function");
    onEvent({ status: "skipped" }, {});
    expect(getTourDone()).toBe(true);
  });
});
