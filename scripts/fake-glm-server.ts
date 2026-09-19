import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { TEST_TONE } from "../src/test/fixtures";

const host = "127.0.0.1";
const port = Number(process.env.FAKE_GLM_PORT ?? 3_208);
const maximumBodySize = 256 * 1024;

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maximumBodySize) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    sendJson(response, 404, { error: { message: "Not found" } });
    return;
  }

  if (request.headers.authorization !== "Bearer e2e-test") {
    sendJson(response, 401, { error: { message: "Invalid test credential" } });
    return;
  }

  try {
    const body = await readJson(request);
    const completionRequest = body as {
      model?: unknown;
      messages?: Array<{ role?: unknown; content?: unknown }>;
      response_format?: { type?: unknown };
    };
    const userMessage = completionRequest.messages?.at(-1);
    if (
      completionRequest.model !== "e2e-model" ||
      completionRequest.response_format?.type !== "json_object" ||
      userMessage?.role !== "user" ||
      userMessage.content !== "A complete progressive lead tone"
    ) {
      sendJson(response, 400, {
        error: { message: "Unexpected completion request" },
      });
      return;
    }

    sendJson(response, 200, {
      id: "chatcmpl-e2e",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model: "e2e-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify(TEST_TONE),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  } catch {
    sendJson(response, 400, { error: { message: "Invalid JSON request" } });
  }
});

server.listen(port, host);

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
