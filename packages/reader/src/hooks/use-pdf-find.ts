"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * DOM-based Find-in-document implementation.
 *
 * Why DOM and not PDF.js's PDFFindController?
 *   react-pdf renders its own TextLayer and never registers it with
 *   PDFFindController, so even a correctly-wired controller's match
 *   coordinates don't translate to visible highlights. We instead walk
 *   the already-rendered `.react-pdf__Page__textContent span` elements
 *   and wrap matches with `<mark class="find-match">` nodes, exactly
 *   like the browser's native Cmd+F highlight, so it works without any
 *   PDF.js plumbing.
 *
 * Behavior:
 *   - search(query, { matchCase }): clear old marks, scan visible spans,
 *     wrap matches.
 *   - next() / prev(): cycle current match index, scroll into view, swap
 *     `.find-match--current` class.
 *   - When new pages render (virtualization), a MutationObserver re-runs
 *     the active query against newly added text spans.
 *   - When the input clears (or query is empty), all marks are removed.
 *
 * Cleanup is conservative: removeAllMarks() unwraps every `<mark>` so the
 * original text node tree is restored — no orphan wrappers remain when
 * the find bar closes.
 */
export function usePdfFind(_pdfDocument: unknown) {
  // Current query state — kept in refs so we can re-apply on DOM mutation
  // without re-renders.
  const queryRef = useRef<string>("");
  const matchCaseRef = useRef<boolean>(false);
  const matchesRef = useRef<HTMLElement[]>([]);
  const currentIdxRef = useRef<number>(-1);
  const observerRef = useRef<MutationObserver | null>(null);
  // Re-mark scheduling — coalesce bursts of mutations into one pass.
  const rescheduleRef = useRef<number | null>(null);

  const removeAllMarks = useCallback(() => {
    const marks = document.querySelectorAll<HTMLElement>("mark.find-match");
    marks.forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      // Replace the <mark> with its text node children, then normalize so
      // adjacent text fragments coalesce back into the original span.
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      // Normalize the parent so split text nodes merge — keeps the span
      // structure stable for future searches.
      if (parent instanceof Element) parent.normalize();
    });
    matchesRef.current = [];
    currentIdxRef.current = -1;
  }, []);

  const setCurrent = useCallback((idx: number, scroll: boolean) => {
    const matches = matchesRef.current;
    if (matches.length === 0) {
      currentIdxRef.current = -1;
      return;
    }
    // Clear prior current
    matches.forEach((m) => m.classList.remove("find-match--current"));
    const wrapped = ((idx % matches.length) + matches.length) % matches.length;
    currentIdxRef.current = wrapped;
    const target = matches[wrapped];
    if (target) {
      target.classList.add("find-match--current");
      if (scroll) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, []);

  const markSpan = useCallback((span: Element, query: string, caseSensitive: boolean) => {
    const text = span.textContent ?? "";
    if (!text) return [] as HTMLElement[];
    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    if (!needle) return [];
    // Find every occurrence index.
    const indices: number[] = [];
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const i = haystack.indexOf(needle, from);
      if (i === -1) break;
      indices.push(i);
      from = i + needle.length;
    }
    if (indices.length === 0) return [];

    // Walk the span's child text nodes once, mapping char offsets → ranges.
    // We rebuild content as a sequence of text + <mark> wrappers preserving
    // any inline structure the text layer might contain.
    const fragment = document.createDocumentFragment();
    const created: HTMLElement[] = [];
    let cursor = 0;
    let matchPtr = 0;

    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let n: Node | null = walker.nextNode();
    while (n) {
      textNodes.push(n as Text);
      n = walker.nextNode();
    }

    // Build a flat plain-text view to slice, then re-emit nodes in order.
    // Simpler implementation: replace span's content wholesale based on
    // the consolidated string. PDF text-layer spans are leaf-text in
    // practice, so this is safe and more robust than partial-walk logic.
    const flat = textNodes.map((t) => t.data).join("");
    if (flat !== text) {
      // Defensive fallback — shouldn't happen for normal text spans.
      return [];
    }

    while (cursor < flat.length) {
      const nextMatch = indices[matchPtr];
      if (nextMatch === undefined) {
        fragment.appendChild(document.createTextNode(flat.slice(cursor)));
        cursor = flat.length;
        break;
      }
      if (cursor < nextMatch) {
        fragment.appendChild(document.createTextNode(flat.slice(cursor, nextMatch)));
        cursor = nextMatch;
      }
      const end = nextMatch + needle.length;
      const mark = document.createElement("mark");
      mark.className = "find-match";
      mark.textContent = flat.slice(nextMatch, end);
      fragment.appendChild(mark);
      created.push(mark);
      cursor = end;
      matchPtr += 1;
    }

    // Replace span contents.
    while (span.firstChild) span.removeChild(span.firstChild);
    span.appendChild(fragment);

    return created;
  }, []);

  const applySearch = useCallback(
    (query: string, opts: { matchCase: boolean }) => {
      removeAllMarks();
      queryRef.current = query;
      matchCaseRef.current = opts.matchCase;
      if (!query) return;
      const spans = document.querySelectorAll<HTMLElement>(
        ".react-pdf__Page__textContent span"
      );
      const all: HTMLElement[] = [];
      spans.forEach((span) => {
        // Skip spans that are themselves a mark wrapper (defensive).
        if (span.tagName.toLowerCase() === "mark") return;
        const created = markSpan(span, query, opts.matchCase);
        if (created.length > 0) all.push(...created);
      });
      matchesRef.current = all;
      if (all.length > 0) setCurrent(0, true);
    },
    [markSpan, removeAllMarks, setCurrent]
  );

  const scheduleRemark = useCallback(() => {
    if (rescheduleRef.current !== null) return;
    rescheduleRef.current = window.requestAnimationFrame(() => {
      rescheduleRef.current = null;
      const q = queryRef.current;
      if (!q) return;
      // Re-run the search against the now-larger DOM. Preserving the
      // current match index isn't meaningful when new pages appear, so
      // we reset to the first match.
      applySearch(q, { matchCase: matchCaseRef.current });
    });
  }, [applySearch]);

  // Observe the document for newly rendered pages so an active query
  // gets applied to spans that didn't exist when search() was called.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      if (!queryRef.current) return;
      // Only react to mutations that touch a text-content layer.
      const relevant = mutations.some((m) => {
        if (m.target instanceof Element) {
          if (m.target.closest?.(".react-pdf__Page__textContent")) return true;
        }
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof Element) {
            if (
              node.classList?.contains("react-pdf__Page__textContent") ||
              node.querySelector?.(".react-pdf__Page__textContent")
            ) {
              return true;
            }
          }
        }
        return false;
      });
      if (relevant) scheduleRemark();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (rescheduleRef.current !== null) {
        cancelAnimationFrame(rescheduleRef.current);
        rescheduleRef.current = null;
      }
      removeAllMarks();
    };
  }, [scheduleRemark, removeAllMarks]);

  const search = useCallback(
    (query: string, opts: { matchCase: boolean }) => {
      applySearch(query, opts);
    },
    [applySearch]
  );

  const next = useCallback(() => {
    if (matchesRef.current.length === 0) return;
    setCurrent(currentIdxRef.current + 1, true);
  }, [setCurrent]);

  const prev = useCallback(() => {
    if (matchesRef.current.length === 0) return;
    setCurrent(currentIdxRef.current - 1, true);
  }, [setCurrent]);

  return { search, next, prev };
}
