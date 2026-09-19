export const MAX_TONE_REQUEST_BYTES = 128 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host")?.trim();
    const effectiveUrl = host
      ? new URL(`${requestUrl.protocol}//${host}`)
      : requestUrl;
    return new URL(origin).origin === effectiveUrl.origin;
  } catch {
    return false;
  }
}

export function hasExactJsonContentType(request: Request): boolean {
  return (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() === "application/json"
  );
}

export async function parseLimitedJson(
  request: Request,
  maximumBytes = MAX_TONE_REQUEST_BYTES,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestBodyTooLargeError();
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new RequestBodyTooLargeError();
  }
  return JSON.parse(text) as unknown;
}
