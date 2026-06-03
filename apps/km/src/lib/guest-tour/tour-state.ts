const STORAGE_KEY = "km:guest_tour_done";

let memoryDone = false;

export function getTourDone(): boolean {
  if (memoryDone) return true;
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

export function setTourDone(): void {
  memoryDone = true;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // localStorage may be unavailable (private mode quota); silently ignore.
  }
}

export function resetTourDoneForTest(): void {
  memoryDone = false;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
