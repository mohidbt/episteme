"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Joyride,
  STATUS,
  EVENTS,
  type EventData,
  type Controls,
  type Step,
} from "react-joyride";
import { getTourDone, setTourDone } from "@/lib/guest-tour/tour-state";
import { waitForSelector } from "@/lib/guest-tour/wait-for-selector";

/**
 * Routes where guest tour autostart is allowed. Anything else (sign-in/up,
 * the guest welcome note redirect target) suppresses autostart so the tour
 * never fires mid-navigation.
 */
function isTourAllowedRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/") return true;
  if (pathname.startsWith("/notes")) return true;
  if (pathname.startsWith("/papers")) return true;
  if (pathname.startsWith("/references")) return true;
  if (pathname.startsWith("/r/")) return true;
  return false;
}

function buildSteps(): Step[] {
  return [
    {
      id: "drive_intro",
      target: '[data-testid="tour-drive-header"]',
      placement: "bottom",
      skipBeacon: true,
      content:
        "Your drive holds 4 things: Notes, Papers, References, and Assets (images). Everything is searchable and connected.",
      data: { next: "/notes" },
    },
    {
      id: "notes_collection",
      target: '[data-testid="tour-nav-notes"]',
      placement: "right",
      skipBeacon: true,
      content:
        "Notes are your living write-ups. Type [[ inside a note to wiki-link any paper, reference, or note. Use Import (top-right) to bring in markdown, PDFs, or BibTeX/RIS.",
      data: { next: "/references" },
    },
    {
      id: "papers_refs_collection",
      target: '[data-testid="tour-nav-references"]',
      placement: "right",
      skipBeacon: true,
      content:
        "References are lightweight citation metadata — no PDF attached. Papers (right above) store the full PDF. Either way, the same Import button handles PDFs, BibTeX, RIS, and EndNote.",
      data: { next: "/" },
    },
    {
      id: "agentball_hint",
      target: '[data-testid="agent-ball"]',
      placement: "left",
      skipBeacon: true,
      content:
        "Press space twice anywhere to summon the agent. Ask anything about your library.",
    },
  ];
}

// Max time to wait for the next-step target to mount after router.push.
// On timeout we resume Joyride anyway so the tour never dead-ends.
const NEXT_TARGET_TIMEOUT_MS = 4000;

export function GuestTour({ isAnonymous }: { isAnonymous: boolean }) {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const steps = useMemo(buildSteps, []);
  // Guard against double-advance from overlapping STEP_AFTER events.
  const advancingRef = useRef(false);

  useEffect(() => {
    if (!isAnonymous) return;
    if (getTourDone()) return;
    if (!isTourAllowedRoute(pathname)) return;
    setRun(true);
  }, [isAnonymous, pathname]);

  /**
   * Drive the controlled Joyride step pointer ourselves.
   *
   * Why: Joyride's internal step pointer auto-advances on `action=next` in
   * `continuous` mode. With a Next.js `router.push(...)` in flight, the next
   * step's `target` selector won't exist yet when Joyride tries to paint it
   * — silent skip or empty spotlight. Pausing (`run=false`) + awaiting the
   * selector + resuming guarantees the next step paints against the new
   * route's DOM.
   */
  async function advanceTo(nextIndex: number, nextRoute: string | null) {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      // Pause Joyride before router.push so the (still-mounted) current-route
      // DOM doesn't get a half-rendered next-step paint.
      setRun(false);
      if (nextRoute) router.push(nextRoute);
      const nextStep = steps[nextIndex];
      const nextTarget = typeof nextStep?.target === "string" ? nextStep.target : null;
      if (nextTarget) {
        // Best-effort wait. Timeout returns null; we resume anyway so the
        // tour never dead-ends — Joyride's own targetWaitTimeout will then
        // surface a TARGET_NOT_FOUND we can observe in logs.
        await waitForSelector(nextTarget, NEXT_TARGET_TIMEOUT_MS);
      }
      setStepIndex(nextIndex);
      setRun(true);
    } finally {
      advancingRef.current = false;
    }
  }

  function handleEvent(data: EventData, _controls: Controls) {
    const status = data.status as string;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setTourDone();
      setRun(false);
      return;
    }

    const type = (data as { type?: string }).type;
    const action = (data as { action?: string }).action;
    const lifecycle = (data as { lifecycle?: string }).lifecycle;
    const index = (data as { index?: number }).index;
    const step = (data as { step?: { data?: { next?: string } } }).step;

    if (
      type === EVENTS.STEP_AFTER &&
      action === "next" &&
      lifecycle === "complete" &&
      typeof index === "number"
    ) {
      const nextRoute = step?.data?.next ?? null;
      void advanceTo(index + 1, nextRoute);
    }
  }

  return (
    <Joyride
      run={run}
      stepIndex={stepIndex}
      steps={steps}
      continuous
      options={{ buttons: ["back", "skip", "primary"], showProgress: true }}
      onEvent={handleEvent}
    />
  );
}
