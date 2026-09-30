import { computeSlashMenuPlacement, type CaretRect } from "./popover-placement";

/**
 * Keep a floating element at a caret or selection rect: below it, above when
 * there is no room, never past a viewport edge. Re-places when anything
 * scrolls, when the window resizes and when the element's own size changes
 * (first render, streamed output). `update` re-places on demand.
 *
 * `position` is how `el` is positioned: "absolute" elements live in document
 * coordinates, "fixed" ones in viewport coordinates. A null rect hides `el`.
 */
export function anchorToCaret(
  el: HTMLElement,
  getRect: () => CaretRect | null,
  position: "absolute" | "fixed",
): { update: () => void; stop: () => void } {
  const place = () => {
    const rect = getRect();
    el.style.visibility = rect ? "" : "hidden";
    if (!rect) return;
    const box = el.getBoundingClientRect();
    const { top, left } = computeSlashMenuPlacement({
      caret: rect,
      menuHeight: box.height,
      menuWidth: box.width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      scrollY: position === "fixed" ? 0 : window.scrollY,
      scrollX: position === "fixed" ? 0 : window.scrollX,
    });
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  };
  place();
  const sizeWatch = new ResizeObserver(place);
  sizeWatch.observe(el);
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
  return {
    update: place,
    stop: () => {
      sizeWatch.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    },
  };
}

/**
 * `rect`, or null once its line has scrolled out of the editor's scroll
 * container (the note page's main column, the reader's notes panel body).
 */
export function caretInView(editorDom: HTMLElement, rect: CaretRect | null): CaretRect | null {
  if (!rect) return null;
  for (let el = editorDom.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    const clip = el.getBoundingClientRect();
    return rect.bottom < clip.top || rect.top > clip.bottom ? null : rect;
  }
  return rect;
}

/**
 * Calls `onChange` when the element's width changes: a panel separator drag,
 * a window resize. Popups anchored inside the element are stale by then.
 */
export function watchWidth(el: HTMLElement, onChange: () => void): () => void {
  let width = el.clientWidth;
  const watch = new ResizeObserver(() => {
    if (el.clientWidth === width) return;
    width = el.clientWidth;
    onChange();
  });
  watch.observe(el);
  return () => watch.disconnect();
}
