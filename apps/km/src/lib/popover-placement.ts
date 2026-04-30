/**
 * Pure positioning helper for the slash-command popover.
 *
 * The Tiptap suggestion plugin gives us the caret rect (viewport coords). We
 * default to placing the popover BELOW the caret. When there's not enough
 * room below the caret to fit the menu, we flip ABOVE the caret instead.
 *
 * Returns absolute-document coordinates (i.e. includes scroll), suitable for
 * a `position: absolute` host appended to `document.body`.
 *
 * G-R3-02 (#68): Slash menu was rendering off-screen at the editor bottom
 * because there was no room below the caret and the page couldn't scroll
 * further. Flip-up fixes this.
 */
export interface CaretRect {
  top: number;
  bottom: number;
  left: number;
}

export interface PlacementInput {
  caret: CaretRect;
  /** Estimated popover height in px. */
  menuHeight: number;
  /** Viewport height (window.innerHeight). */
  viewportHeight: number;
  /** Page scroll offset Y (window.scrollY). */
  scrollY: number;
  /** Page scroll offset X (window.scrollX). */
  scrollX: number;
  /** Gap between caret and popover, px. Default 4. */
  gap?: number;
}

export interface PlacementResult {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

export function computeSlashMenuPlacement(input: PlacementInput): PlacementResult {
  const gap = input.gap ?? 4;
  const roomBelow = input.viewportHeight - input.caret.bottom;
  const roomAbove = input.caret.top;

  // Flip up only when below is insufficient AND above has more room.
  const flipUp = roomBelow < input.menuHeight + gap && roomAbove > roomBelow;

  if (flipUp) {
    return {
      top: input.caret.top + input.scrollY - input.menuHeight - gap,
      left: input.caret.left + input.scrollX,
      placement: "top",
    };
  }
  return {
    top: input.caret.bottom + input.scrollY + gap,
    left: input.caret.left + input.scrollX,
    placement: "bottom",
  };
}
