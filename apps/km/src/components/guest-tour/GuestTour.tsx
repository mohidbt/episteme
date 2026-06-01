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
import { TourPreviewCard } from "./TourPreviewCard";

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

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function buildSteps(onCtaClick: () => void): Step[] {
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
    {
      id: "graph_intro",
      target: "body",
      placement: "center",
      skipBeacon: true,
      content: (
        <TourPreviewCard
          title="Graph view"
          caption="Lines are set connections. Proximity is semantic similarity — papers that read alike sit closer."
          mediaSrc="/tour/graph_intro.svg"
          mediaAlt="Graph view illustration with nodes and edges"
        />
      ),
    },
    {
      id: "wow_refs_fill",
      target: "body",
      placement: "center",
      skipBeacon: true,
      content: (
        <TourPreviewCard
          title="Fill missing reference fields"
          caption="Drop a half-filled BibTeX entry. The agent fills in DOI, authors, year, and abstract."
          mediaSrc="/tour/wow_refs_fill.svg"
          mediaAlt="Reference row going from sparse to filled"
        />
      ),
    },
    {
      id: "wow_reader_highlight",
      target: "body",
      placement: "center",
      skipBeacon: true,
      content: (
        <TourPreviewCard
          title="Highlight numerical findings"
          caption="Ask the agent to highlight quantitative claims. It returns inline spans rendered right in the reader."
          mediaSrc="/tour/wow_reader_highlight.svg"
          mediaAlt="Reader page with highlighted numerical spans"
        />
      ),
    },
    {
      id: "wow_deepread",
      target: "body",
      placement: "center",
      skipBeacon: true,
      content: (
        <TourPreviewCard
          title="Agentic PDF search"
          caption="Ask one question across all your PDFs. The agent searches, cites, and summarizes."
          mediaSrc="/tour/wow_deepread.svg"
          mediaAlt="Cross-paper question with cited answers"
        />
      ),
    },
    {
      id: "wow_extract",
      target: "body",
      placement: "center",
      skipBeacon: true,
      content: (
        <TourPreviewCard
          title="Paperset enrich (concurrent)"
          caption="Define columns once. The agent enriches every row in parallel."
          mediaSrc="/tour/wow_extract.svg"
          mediaAlt="Paperset grid with cells filling concurrently"
        />
      ),
    },
    {
      id: "signup_cta",
      target: "body",
      placement: "center",
      skipBeacon: true,
      content: (
        <TourPreviewCard
          title="Ready to make this yours?"
          caption="Sign up to keep your work, run real agents, and connect your library."
          mediaAlt=""
          previewBadge={false}
          cta={{ label: "Sign up free", href: "/sign-up", onClick: onCtaClick }}
        />
      ),
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
  const reduceMotion = useMemo(prefersReducedMotion, []);
  // CTA click handler: flag tour done BEFORE navigation so a sign-up cancel +
  // reload doesn't retrigger the tour.
  const handleCtaClick = useMemo(
    () => () => {
      setTourDone();
      setRun(false);
    },
    [],
  );
  const steps = useMemo(() => buildSteps(handleCtaClick), [handleCtaClick]);
  // Guard against double-advance from overlapping STEP_AFTER events.
  const advancingRef = useRef(false);

  useEffect(() => {
    // Don't toggle `run` back to true while an advanceTo() is in flight —
    // advanceTo intentionally pauses (setRun(false)) before router.push, and
    // the pathname change that push triggers would otherwise re-fire this
    // effect and resume Joyride BEFORE waitForSelector resolves, regenerating
    // the auto-nav race we fixed in Round 2.5.
    if (advancingRef.current) return;
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
    const action = (data as { action?: string }).action;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED || action === "close") {
      setTourDone();
      setRun(false);
      return;
    }

    const type = (data as { type?: string }).type;
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
      // Forward-only tour: omit "back" from buttons. Joyride v3 has no
      // `hideBackButton` option; the buttons array IS the back/skip/primary
      // toggle. Back would desync controlled `stepIndex` mode anyway.
      options={{
        buttons: ["skip", "primary"],
        showProgress: true,
        // Reduced-motion support: kill scroll-into-view animation when
        // `prefers-reduced-motion: reduce` matches. Joyride v3 routes both
        // toggles through `options`; there's no top-level disableScrolling or
        // floaterProps prop on the v3 Joyride component.
        ...(reduceMotion ? { skipScroll: true, scrollDuration: 0 } : {}),
      }}
      onEvent={handleEvent}
    />
  );
}
