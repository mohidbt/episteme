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
  __getBucketSizeForTests(): number;
}

export function createRateLimit(options: RateLimitOptions): RateLimit {
  const { perMinute, perDay, now } = options;
  const buckets = new Map<string, BucketState>();

  return {
    check(ip: string): RateLimitResult {
      const t = now();
      // Lazy GC: on each check, sweep any entries whose day window fully
      // elapsed — those IPs went silent for >24h and no longer need state.
      // Bounds the Map to the set of IPs active in the last day window;
      // without this, abuse traffic (one hit per IP, never seen again) would
      // grow the Map unbounded over time.
      for (const [k, v] of buckets) {
        if (t - v.dayStart >= DAY_MS) buckets.delete(k);
      }
      let b = buckets.get(ip);
      if (!b) {
        b = { minuteStart: t, minuteCount: 0, dayStart: t, dayCount: 0 };
        buckets.set(ip, b);
      }
      if (t - b.minuteStart >= MINUTE_MS) {
        b.minuteStart = t;
        b.minuteCount = 0;
      }
      // Day-window reset is handled by the lazy GC sweep above (stale entries
      // are deleted; survivors have t - dayStart < DAY_MS by construction).
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
    __getBucketSizeForTests(): number {
      return buckets.size;
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
  // Prefer x-real-ip — Vercel/most reverse proxies set this to the true edge
  // IP (one value, set by infra, not user-controllable). Falling back to the
  // RIGHTMOST x-forwarded-for hop is the safe XFF semantic: clients can prepend
  // arbitrary spoofed entries to the LEFT, but the rightmost entry was set by
  // our own proxy and can be trusted.
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",");
    const rightmost = hops[hops.length - 1].trim();
    if (rightmost) return rightmost;
  }
  return "unknown";
}
