// Sliver predicate matching the Python `is_stale_rect` in
// `services/agents/lib/auto_highlight_tools.py`. Keep both literally
// equivalent — same threshold, same AND semantics.
export const STALE_RECT_MIN_WIDTH = 5.0;
export const STALE_RECT_MIN_HEIGHT = 2.0;

export function isStaleRect(rect: Record<string, unknown>): boolean {
  const x0 = Number(rect.x0);
  const x1 = Number(rect.x1);
  const y0 = Number(rect.y0);
  const y1 = Number(rect.y1);
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return false;
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return false;
  const width = x1 - x0;
  const height = y1 - y0;
  return width < STALE_RECT_MIN_WIDTH && height < STALE_RECT_MIN_HEIGHT;
}
