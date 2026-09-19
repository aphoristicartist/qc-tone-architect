import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter, getClientIdentifier } from "./rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the limit and reports retry timing", () => {
    const limiter = new FixedWindowRateLimiter(2, 10_000);

    expect(limiter.consume("client", 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("client", 2_000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("client", 3_000)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 8,
    });
  });

  it("starts a new window after expiry and isolates clients", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000);

    expect(limiter.consume("first", 0).allowed).toBe(true);
    expect(limiter.consume("first", 500).allowed).toBe(false);
    expect(limiter.consume("second", 500).allowed).toBe(true);
    expect(limiter.consume("first", 1_000).allowed).toBe(true);
  });

  it("bounds client state and evicts the oldest active window", () => {
    const limiter = new FixedWindowRateLimiter(1, 10_000, 2);

    expect(limiter.consume("first", 0).allowed).toBe(true);
    expect(limiter.consume("second", 1).allowed).toBe(true);
    expect(limiter.consume("third", 2).allowed).toBe(true);
    expect(limiter.consume("first", 3).allowed).toBe(true);
  });
});

describe("getClientIdentifier", () => {
  it("uses the first forwarded address", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    });

    expect(getClientIdentifier(request)).toBe("203.0.113.1");
  });

  it("falls back to a stable local identifier", () => {
    expect(getClientIdentifier(new Request("http://localhost"))).toBe("local");
  });

  it("bounds untrusted forwarded identifiers", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "x".repeat(1_000) },
    });

    expect(getClientIdentifier(request)).toHaveLength(128);
  });
});
