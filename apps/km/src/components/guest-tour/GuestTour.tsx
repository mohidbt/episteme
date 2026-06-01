"use client";

import { useEffect, useMemo, useState } from "react";
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
      data: { next: "/papers" },
    },
    {
      id: "papers_refs_collection",
      target: '[data-testid="tour-nav-papers"]',
      placement: "right",
      skipBeacon: true,
      content:
        "Papers store the full PDF. References are lightweight metadata when you want to cite without storing the file. The same Import button handles PDFs, BibTeX, RIS, and EndNote.",
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

export function GuestTour({ isAnonymous }: { isAnonymous: boolean }) {
  const [run, setRun] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const steps = useMemo(buildSteps, []);

  useEffect(() => {
    if (!isAnonymous) return;
    if (getTourDone()) return;
    if (!isTourAllowedRoute(pathname)) return;
    setRun(true);
  }, [isAnonymous, pathname]);

  function handleEvent(data: EventData, _controls: Controls) {
    const status = data.status as string;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setTourDone();
      setRun(false);
      return;
    }

    const type = (data as { type?: string }).type;
    const action = (data as { action?: string }).action;
    const step = (data as { step?: { data?: { next?: string } } }).step;
    if (type === EVENTS.STEP_AFTER && action === "next" && step?.data?.next) {
      const target = step.data.next;
      router.push(target);
      // Best-effort: wait for any anchor element on the next route to mount
      // so Joyride doesn't paint the next step on an empty DOM. Failure to
      // resolve is non-fatal — Joyride will simply skip or retry.
      void waitForSelector(
        '[data-testid="tour-nav-notes"], [data-testid="tour-nav-papers"], [data-testid="tour-drive-header"], [data-testid="agent-ball"]',
        4000,
      );
    }
  }

  return (
    <Joyride
      run={run}
      steps={steps}
      continuous
      options={{ buttons: ["back", "skip", "primary"], showProgress: true }}
      onEvent={handleEvent}
    />
  );
}
