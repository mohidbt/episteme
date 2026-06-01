/**
 * Resolve to the first element matching `selector`, or `null` if it never
 * appears within `timeoutMs`. Used to gate Joyride step advance when targets
 * mount asynchronously after route transitions.
 */
export function waitForSelector(
  selector: string,
  timeoutMs = 4000,
): Promise<Element | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
