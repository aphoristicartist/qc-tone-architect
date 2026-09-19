import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "./api-request";

function makeRequest(origin?: string, host?: string) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (host) headers.set("Host", host);
  return new Request("http://localhost:3000/api/example", { headers });
}

describe("API request origin checks", () => {
  it("accepts the public Host origin when the framework URL uses an internal host", () => {
    expect(
      isSameOriginRequest(
        makeRequest("http://127.0.0.1:3207", "127.0.0.1:3207"),
      ),
    ).toBe(true);
  });

  it("falls back to the request URL when Host is unavailable", () => {
    expect(isSameOriginRequest(makeRequest("http://localhost:3000"))).toBe(true);
  });

  it.each([
    makeRequest(),
    makeRequest("https://example.com", "127.0.0.1:3207"),
    makeRequest("not a URL", "127.0.0.1:3207"),
    makeRequest("http://127.0.0.1:3207", "not a valid host/path"),
  ])("rejects missing, cross-origin, or malformed metadata", (request) => {
    expect(isSameOriginRequest(request)).toBe(false);
  });
});
