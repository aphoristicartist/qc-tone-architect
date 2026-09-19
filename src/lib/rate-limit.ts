export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowState {
  count: number;
  resetsAt: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maximumKeys = 10_000,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Rate limit must be a positive integer");
    }
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new Error("Rate-limit window must be positive");
    }
    if (!Number.isInteger(maximumKeys) || maximumKeys < 1) {
      throw new Error("Maximum rate-limit keys must be a positive integer");
    }
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const current = this.windows.get(key);
    if (!current && this.windows.size >= this.maximumKeys) {
      this.pruneExpiredWindows(now);
      if (this.windows.size >= this.maximumKeys) {
        const oldestKey = this.windows.keys().next().value as string | undefined;
        if (oldestKey !== undefined) this.windows.delete(oldestKey);
      }
    }
    const state =
      !current || current.resetsAt <= now
        ? { count: 0, resetsAt: now + this.windowMs }
        : current;

    if (state.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((state.resetsAt - now) / 1_000),
        ),
      };
    }

    state.count += 1;
    this.windows.set(key, state);
    return {
      allowed: true,
      remaining: this.limit - state.count,
      retryAfterSeconds: 0,
    };
  }

  reset(): void {
    this.windows.clear();
  }

  private pruneExpiredWindows(now: number): void {
    for (const [key, state] of this.windows) {
      if (state.resetsAt <= now) this.windows.delete(key);
    }
  }
}

export function getClientIdentifier(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedAddress = forwardedFor?.split(",")[0]?.trim();
  const identifier =
    firstForwardedAddress ||
    request.headers.get("x-real-ip")?.trim() ||
    "local";
  return identifier.slice(0, 128);
}

export const toneGenerationRateLimiter = new FixedWindowRateLimiter(10, 60_000);
