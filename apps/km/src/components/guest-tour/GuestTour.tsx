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
  if (pathname.startsWith("/drive/")) return true;
  if (pathname === "/trash") return true;
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

// Wider tooltip for preview-card steps so the embedded .webm renders at a
// usable size (default Joyride width ~290px squeezes the video).
const PREVIEW_TOOLTIP_STYLES = {
  tooltip: { width: 720, maxWidth: "90vw" as const },
} as const;

type StepData = { next?: string; prev?: string };

function buildSteps(): Step[] {
  return [
    {
      id: "drive_intro",
      target: '[data-testid="tour-drive-header"]',
      placement: "bottom",
      skipBeacon: true,
      content:
        "Your drive holds 4 things: Notes, Papers, References, and Assets (images). Everything is searchable and connected.",
      data: { next: "/notes" } as StepData,
      // First step: no "Back" — there is nowhere to go back to. Joyride v3
      // has no `hideBackButton` prop; hide via per-step styles override.
      styles: { buttonBack: { display: "none" } },
    },
    {
      id: "notes_collection",
      target: '[data-testid="tour-nav-notes"]',
      placement: "right",
      skipBeacon: true,
      content:
        "Notes are your living write-ups. Type [[ inside a note to wiki-link any paper, reference, or note. Use Import (top-right) to bring in markdown, PDFs, or BibTeX/RIS.",
      data: { next: "/references", prev: "/" } as StepData,
    },
    {
      id: "papers_refs_collection",
      target: '[data-testid="tour-nav-references"]',
      placement: "right",
      skipBeacon: true,
      content:
        "References are lightweight citation metadata — no PDF attached. Papers (right above) store the full PDF. Either way, the same Import button handles PDFs, BibTeX, RIS, and EndNote.",
      data: { next: "/", prev: "/notes" } as StepData,
    },
    {
      id: "agentball_hint",
      target: '[data-testid="agent-ball"]',
      placement: "left",
      skipBeacon: true,
      content:
        "Press space twice anywhere to summon the agent. Ask anything about your library.",
      data: { prev: "/references" } as StepData,
    },
    {
      id: "wow_paper_understanding",
      target: "body",
      placement: "center",
      skipBeacon: true,
      styles: PREVIEW_TOOLTIP_STYLES,
      content: (
        <TourPreviewCard
          title="Cross-paper understanding"
          caption="Ask the agent across papers. It reads each one, threads the answers, then writes a note that wiki-links the sources."
          mediaSrc="/tour/wow_paper_understanding.webm"
          mediaPoster="/tour/wow_paper_understanding.poster.jpg"
          mediaAlt="Agent answering a cross-paper question and writing a linked note"
        />
      ),
    },
    {
      id: "graph_intro",
      target: "body",
      placement: "center",
      skipBeacon: true,
      styles: PREVIEW_TOOLTIP_STYLES,
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
      styles: PREVIEW_TOOLTIP_STYLES,
      content: (
        <TourPreviewCard
          title="Fill missing reference fields"
          caption="Drop a half-filled BibTeX entry. The agent fills in DOI, authors, year, and abstract."
          mediaSrc="/tour/wow_refs_fill.webm"
          mediaPoster="/tour/wow_refs_fill.poster.jpg"
          mediaAlt="Reference row going from sparse to filled"
        />
      ),
    },
    {
      id: "wow_reader_highlight",
      target: "body",
      placement: "center",
      skipBeacon: true,
      styles: PREVIEW_TOOLTIP_STYLES,
      content: (
        <TourPreviewCard
          title="Highlight numerical findings"
          caption="Ask the agent to highlight quantitative claims. It proposes spans, you approve, and they land in the sidebar — click to jump back to the page."
          mediaSrc="/tour/wow_reader_highlight.webm"
          mediaPoster="/tour/wow_reader_highlight.poster.jpg"
          mediaAlt="Reader page with proposed highlights, approval, and sidebar click-through"
        />
      ),
    },
    {
      id: "wow_paper_search",
      target: "body",
      placement: "center",
      skipBeacon: true,
      styles: PREVIEW_TOOLTIP_STYLES,
      content: (
        <TourPreviewCard
          title="One-click PDF discovery"
          caption="On any reference with no PDF attached, click Agentic PDF Search. The agent finds the PDF online and links it."
          mediaSrc="/tour/wow_paper_search.webm"
          mediaPoster="/tour/wow_paper_search.poster.jpg"
          mediaAlt="Agentic PDF search finding a paper for a reference"
        />
      ),
    },
    {
      id: "wow_extract",
      target: "body",
      placement: "center",
      skipBeacon: true,
      styles: PREVIEW_TOOLTIP_STYLES,
      content: (
        <TourPreviewCard
          title="Paperset enrich (concurrent)"
          caption="Define columns once. The agent enriches every row in parallel — watch the bottom row fill cell by cell."
          mediaSrc="/tour/wow_extract.webm"
          mediaPoster="/tour/wow_extract.poster.jpg"
          mediaAlt="Paperset grid with cells filling concurrently"
        />
      ),
    },
    {
      id: "signup_cta",
      target: "body",
      placement: "center",
      skipBeacon: true,
      // Single primary action: Joyride's footer "Sign up free" button
      // (relabeled via locale.last on the final step). The in-card CTA
      // would visually disconnect from the footer — drop it.
      content: (
        <TourPreviewCard
          title="Ready to make this yours?"
          caption="Sign up to keep your work, run real agents, and connect your library."
          mediaAlt=""
          previewBadge={false}
        />
      ),
    },
  ];
}

// Max time to wait for the next-step target to mount after router.push.
// On timeout we resume Joyride anyway so the tour never dead-ends.
const NEXT_TARGET_TIMEOUT_MS = 4000;

// Design-system theme for the tour chrome. We map every color onto the app's
// CSS variables (globals.css), so the tour reads as native black-on-white and
// flips to dark mode for free — react-joyride applies these as inline styles,
// so var(--…) resolves at runtime. v3 reads color tokens from `options`.
const TOUR_THEME = {
  primaryColor: "var(--primary)",
  backgroundColor: "var(--popover)",
  arrowColor: "var(--popover)",
  textColor: "var(--foreground)",
  // Spotlight contrast; intentionally mode-agnostic (overlay sits above content).
  overlayColor: "oklch(0 0 0 / 0.45)",
  spotlightRadius: 10, // matches --radius (0.625rem)
  width: 360,
  zIndex: 200,
};

// Per-element CSS. The design system says borders carry weight, not shadows —
// a single hairline + low-spread popover shadow. Titles/body use the app fonts;
// the popover shadow is inlined because --shadow-pop lives only in the design
// bundle, not globals.css.
const TOUR_STYLES = {
  tooltip: {
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    boxShadow:
      "0 4px 16px -8px oklch(0 0 0 / 0.18), 0 2px 4px -2px oklch(0 0 0 / 0.06)",
    fontFamily: "var(--font-sans)",
    padding: 16,
  },
  tooltipContainer: { textAlign: "left" as const },
  tooltipTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 16,
    fontWeight: 400,
  },
  tooltipContent: {
    padding: "8px 0 0",
    fontSize: 14,
    lineHeight: "22px",
    textAlign: "left" as const,
    color: "var(--foreground)",
  },
  tooltipFooter: { marginTop: 12 },
  buttonPrimary: {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
    borderRadius: "var(--radius)",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    fontWeight: 500,
    padding: "8px 14px",
  },
  buttonBack: {
    color: "var(--muted-foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    marginRight: 8,
  },
  buttonSkip: {
    color: "var(--muted-foreground)",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
  },
  buttonClose: { color: "var(--muted-foreground)" },
};

export function GuestTour({ isAnonymous }: { isAnonymous: boolean }) {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useMemo(prefersReducedMotion, []);
  const steps = useMemo(() => buildSteps(), []);
  // Guard against double-advance from overlapping STEP_AFTER events.
  const advancingRef = useRef(false);
  // Once we've autostarted, don't re-fire autostart on subsequent allowed
  // pathnames — the tour is now driving its own pathname changes. Re-firing
  // setRun(true) here was the smoking gun for Bug 3 (drive_intro → notes
  // glitch): after advanceTo(1,'/notes') finished, the pathname effect
  // observed pathname change but advancingRef had already been cleared in
  // `finally`, so a late waitForSelector resolution could have flipped run
  // back on at the wrong stepIndex.
  const startedRef = useRef(false);
  // Mirror controlled stepIndex so the event handler always sees the latest
  // value (avoids stale-closure when STEP_AFTER fires across a render).
  const stepIndexRef = useRef(0);
  stepIndexRef.current = stepIndex;

  useEffect(() => {
    // Don't toggle `run` back to true while an advanceTo() is in flight —
    // advanceTo intentionally pauses (setRun(false)) before router.push, and
    // the pathname change that push triggers would otherwise re-fire this
    // effect and resume Joyride BEFORE waitForSelector resolves, regenerating
    // the auto-nav race we fixed in Round 2.5.
    if (advancingRef.current) return;
    // Bug 3 fix: once started, this effect is no longer the source of truth
    // for `run` — advanceTo/goBackTo are. Autostart is one-shot.
    if (startedRef.current) return;
    if (!isAnonymous) return;
    if (getTourDone()) return;
    if (!isTourAllowedRoute(pathname)) return;

    // Preflight: route gating alone is insufficient. `/` can render an
    // empty-library state (no FileBrowser → no `[data-testid="tour-drive-header"]`),
    // and Joyride would paint a dim overlay with no spotlight. Wait for the
    // step-0 target to actually exist before flipping run=true.
    const firstTarget = steps[0]?.target;
    if (typeof firstTarget !== "string") return;

    let cancelled = false;
    const targetPathname = pathname;
    void waitForSelector(firstTarget, 1500).then((el) => {
      if (cancelled) return;
      // Re-check every gate — pathname/isAnonymous/done-flag may have changed
      // while the promise was pending.
      if (advancingRef.current) return;
      if (startedRef.current) return;
      if (!isAnonymous) return;
      if (getTourDone()) return;
      if (pathname !== targetPathname) return;
      if (!el) return;
      startedRef.current = true;
      setStepIndex(0);
      setRun(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isAnonymous, pathname, steps]);

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
      if (nextTarget && nextTarget !== "body") {
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

  /** Symmetric helper for back navigation across routes. */
  async function goBackTo(prevIndex: number, prevRoute: string | null) {
    if (advancingRef.current) return;
    if (prevIndex < 0) return;
    advancingRef.current = true;
    try {
      setRun(false);
      if (prevRoute) router.push(prevRoute);
      const prevStep = steps[prevIndex];
      const prevTarget = typeof prevStep?.target === "string" ? prevStep.target : null;
      if (prevTarget && prevTarget !== "body") {
        await waitForSelector(prevTarget, NEXT_TARGET_TIMEOUT_MS);
      }
      setStepIndex(prevIndex);
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
    const step = (data as { step?: { id?: string; data?: StepData } }).step;

    // Bug 1: signup_cta — Joyride's primary "Sign up free" button (relabeled
    // via locale.last) IS the CTA. Intercept the final-step `next` to flag
    // tour-done + route to /sign-up instead of merely closing the tour.
    if (
      type === EVENTS.STEP_AFTER &&
      action === "next" &&
      lifecycle === "complete" &&
      step?.id === "signup_cta"
    ) {
      setTourDone();
      setRun(false);
      router.push("/sign-up");
      return;
    }

    if (
      type === EVENTS.STEP_AFTER &&
      lifecycle === "complete" &&
      typeof index === "number"
    ) {
      // Bug 3 defense: only act on user-initiated next/prev. Joyride emits
      // STEP_AFTER with action=update on internal transitions (e.g. step
      // unmount during pause) — those must NOT advance/retreat the index.
      if (action === "next") {
        // Stale-event guard: if Joyride emits STEP_AFTER for an index we've
        // already moved past (controlled-mode lag), ignore it. The user-
        // reported "drive flashes then jumps to notes, progress stuck at
        // 1/11" pattern matches a STEP_AFTER for index=0 firing after we
        // already advanced — without this guard we'd advance again to 2.
        if (index !== stepIndexRef.current) return;
        const nextRoute = step?.data?.next ?? null;
        void advanceTo(index + 1, nextRoute);
      } else if (action === "prev") {
        if (index !== stepIndexRef.current) return;
        const prevRoute = step?.data?.prev ?? null;
        void goBackTo(index - 1, prevRoute);
      }
    }
  }

  return (
    <Joyride
      run={run}
      stepIndex={stepIndex}
      steps={steps}
      continuous
      // Sentence-case button labels (design system). On the final step
      // (signup_cta), Joyride uses `locale.last` as the primary button
      // label — relabeled to "Sign up free" so the CTA lives in the
      // tooltip footer (Bug 1 fix: no second misaligned in-card CTA).
      locale={{
        skip: "Skip",
        next: "Next",
        last: "Sign up free",
        back: "Back",
        close: "Close",
      }}
      styles={TOUR_STYLES}
      options={{
        // Bug 4: re-enable back navigation. Per-step `hideBackButton: true`
        // on drive_intro suppresses it where there's nowhere to go back.
        buttons: ["back", "skip", "primary"],
        showProgress: true,
        // Design tokens (colors, radius, width) — see TOUR_THEME.
        ...TOUR_THEME,
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
