// In-memory token-bucket rate limiter for anonymous AI requests.
// Bound to one Node process — sufficient for Phase 1.1 single-instance deploy.
// Multi-instance or edge deploys will need a shared store (Redis/Upstash).

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the most-restrictive bucket refills, when not allowed. */
  retryAfter?: number;
}

export interface RateLimitOptions {
  perMinute: number;
  perDay: number;
  now: () => number;
}

interface BucketState {
  // Timestamp (ms) of the first hit in the current minute window.
  minuteStart: number;
  minuteCount: number;
  // Timestamp (ms) of the first hit in the current day window.
  dayStart: number;
  dayCount: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RateLimit {
  check(ip: string): RateLimitResult;
}

export function createRateLimit(options: RateLimitOptions): RateLimit {
  const { perMinute, perDay, now } = options;
  const buckets = new Map<string, BucketState>();

  return {
    check(ip: string): RateLimitResult {
      const t = now();
      let b = buckets.get(ip);
      if (!b) {
        b = { minuteStart: t, minuteCount: 0, dayStart: t, dayCount: 0 };
        buckets.set(ip, b);
      }
      if (t - b.minuteStart >= MINUTE_MS) {
        b.minuteStart = t;
        b.minuteCount = 0;
      }
      if (t - b.dayStart >= DAY_MS) {
        b.dayStart = t;
        b.dayCount = 0;
      }
      if (b.minuteCount >= perMinute) {
        const retryAfter = Math.max(1, Math.ceil((MINUTE_MS - (t - b.minuteStart)) / 1000));
        return { allowed: false, retryAfter };
      }
      if (b.dayCount >= perDay) {
        const retryAfter = Math.max(1, Math.ceil((DAY_MS - (t - b.dayStart)) / 1000));
        return { allowed: false, retryAfter };
      }
      b.minuteCount += 1;
      b.dayCount += 1;
      return { allowed: true };
    },
  };
}

// Default singleton used by API routes. Tests for the bucket logic build their
// own instance; route-level tests reset module state via __resetRateLimitForTests.
let defaultLimiter = createRateLimit({ perMinute: 5, perDay: 30, now: () => Date.now() });

export function rateLimit(ip: string): RateLimitResult {
  return defaultLimiter.check(ip);
}

export function __resetRateLimitForTests(): void {
  defaultLimiter = createRateLimit({ perMinute: 5, perDay: 30, now: () => Date.now() });
}

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  // Leftmost XFF entry — known IP-spoofable. Acceptable for Phase 1.1 since
  // anon abuse risk is bounded by the shared LLM key budget; harden post-launch
  // by trusting only the rightmost N hops behind a known proxy.
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
