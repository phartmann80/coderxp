import { NextRequest, NextResponse } from "next/server";
import {
  validateAndTranslateRequest,
  AnthropicStreamTranslator,
  SERVER_RESOURCE_LIMITS,
} from "@/lib/server/agent-anthropic-adapter";
import type { AgentTransportRequest, AgentTransportEvent } from "@/lib/workspace/agent-transport-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Active stream accounting
let activeStreamCount = 0;
const MAX_GLOBAL_CONCURRENT_STREAMS = 50;

function isHeaderSafeApiKey(key: string): boolean {
  if (typeof key !== "string" || key.trim().length === 0) return false;
  if (key.length > 256) return false;
  // Disallow control characters or newlines
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 33 || code > 126) return false;
  }
  return true;
}

export async function POST(req: NextRequest): Promise<Response> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      { errorCode: "INVALID_REQUEST", message: "Content-Type must be application/json." },
      { status: 400 },
    );
  }

  // 1. BYOK Key Validation (Mandatory for M3.9 — Server-funded fallback disabled)
  const byokKey = req.headers.get("x-coderxp-byok-key")?.trim() ?? "";
  if (!isHeaderSafeApiKey(byokKey)) {
    return NextResponse.json(
      {
        errorCode: "INVALID_CREDENTIALS",
        message: "A valid Anthropic API key is required. Please provide your BYOK credential.",
      },
      { status: 401 },
    );
  }

  // 2. Concurrency check
  if (activeStreamCount >= MAX_GLOBAL_CONCURRENT_STREAMS) {
    return NextResponse.json(
      { errorCode: "RATE_LIMITED", message: "Server capacity reached. Please try again shortly." },
      { status: 429 },
    );
  }

  // 3. Read Body & Size Limit
  let rawBodyText: string;
  try {
    rawBodyText = await req.text();
  } catch {
    return NextResponse.json(
      { errorCode: "INVALID_REQUEST", message: "Failed to read request body." },
      { status: 400 },
    );
  }

  if (Buffer.byteLength(rawBodyText, "utf8") > SERVER_RESOURCE_LIMITS.maxRequestBodyBytes) {
    return NextResponse.json(
      { errorCode: "REQUEST_TOO_LARGE", message: "Request body exceeds maximum limit (1 MB)." },
      { status: 413 },
    );
  }

  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = JSON.parse(rawBodyText);
  } catch {
    return NextResponse.json(
      { errorCode: "INVALID_REQUEST", message: "Malformed JSON payload." },
      { status: 400 },
    );
  }

  const transportReq = parsedBody as unknown as AgentTransportRequest;
  const translationResult = validateAndTranslateRequest(transportReq, {
    model: typeof parsedBody.model === "string" ? parsedBody.model : undefined,
    temperature: typeof parsedBody.temperature === "number" ? parsedBody.temperature : undefined,
    maxTokens: typeof parsedBody.maxTokens === "number" ? parsedBody.maxTokens : undefined,
  });

  if (!translationResult.ok) {
    return NextResponse.json(
      { errorCode: translationResult.errorCode, message: translationResult.message },
      { status: translationResult.status },
    );
  }

  const requestId = transportReq.requestId || `req-${Date.now()}`;
  const turnId = transportReq.turnId || `turn-${Date.now()}`;
  const abortController = new AbortController();

  // Forward client abort to upstream abort controller
  if (req.signal.aborted) {
    abortController.abort();
  } else {
    req.signal.addEventListener("abort", () => {
      abortController.abort();
    });
  }

  activeStreamCount++;
  let streamCountReleased = false;
  const releaseStreamCount = () => {
    if (!streamCountReleased) {
      streamCountReleased = true;
      activeStreamCount = Math.max(0, activeStreamCount - 1);
    }
  };

  const encoder = new TextEncoder();

  const responseStream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const safeEnqueue = (event: AgentTransportEvent) => {
        if (isClosed) return;
        try {
          const sseLine = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(sseLine));
        } catch {
          // Stream cancelled by client
        }
      };

      const closeStream = () => {
        if (!isClosed) {
          isClosed = true;
          releaseStreamCount();
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };

      const translator = new AnthropicStreamTranslator(requestId, turnId, (event) => {
        safeEnqueue(event);
      });

      // Stream timeout guard
      const streamTimer = setTimeout(() => {
        if (!translator.isTerminalCommitted()) {
          translator.emitTerminalError("PROVIDER_TIMEOUT", "Streaming request timed out.");
          abortController.abort();
          closeStream();
        }
      }, SERVER_RESOURCE_LIMITS.streamTimeoutMs);

      try {
        const upstreamResponse = await fetch(ANTHROPIC_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": byokKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(translationResult.body),
          signal: abortController.signal,
        });

        if (!upstreamResponse.ok) {
          clearTimeout(streamTimer);
          let errorCode = "UPSTREAM_ERROR";
          let errorMsg = `Upstream provider returned HTTP ${upstreamResponse.status}.`;

          if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
            errorCode = "INVALID_CREDENTIALS";
            errorMsg = "Provided Anthropic API key was rejected by the provider.";
          } else if (upstreamResponse.status === 429) {
            errorCode = "RATE_LIMITED";
            errorMsg = "Anthropic rate limit exceeded. Please wait before retrying.";
          } else if (upstreamResponse.status >= 500) {
            errorCode = "PROVIDER_UNAVAILABLE";
            errorMsg = "Anthropic service is temporarily unavailable.";
          }

          translator.emitTerminalError(errorCode, errorMsg);
          closeStream();
          return;
        }

        if (!upstreamResponse.body) {
          clearTimeout(streamTimer);
          translator.emitTerminalError("UPSTREAM_PROTOCOL_ERROR", "Upstream response body was empty.");
          closeStream();
          return;
        }

        const reader = upstreamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === "[DONE]") {
                if (!translator.isTerminalCommitted()) {
                  translator.emitTerminalCompleted("stop");
                }
                continue;
              }

              try {
                const eventObj = JSON.parse(dataStr);
                translator.handleAnthropicEvent(eventObj);
              } catch {
                translator.emitTerminalError("UPSTREAM_PROTOCOL_ERROR", "Failed to parse upstream event data.");
                break;
              }
            }
          }

          if (translator.isTerminalCommitted()) {
            break;
          }
        }

        clearTimeout(streamTimer);

        // Fail-closed check: if upstream closed without terminal completion
        if (!translator.isTerminalCommitted()) {
          translator.emitTerminalError(
            "UPSTREAM_PREMATURE_CLOSE",
            "Upstream stream closed without a terminal completion event.",
          );
        }
      } catch (err: unknown) {
        clearTimeout(streamTimer);
        if (abortController.signal.aborted) {
          translator.emitTerminalCancelled("Request cancelled by client.");
        } else {
          translator.emitTerminalError(
            "PROVIDER_UNAVAILABLE",
            "Failed to establish connection with upstream provider.",
          );
        }
      } finally {
        closeStream();
      }
    },
    cancel() {
      abortController.abort();
      releaseStreamCount();
    },
  });

  return new Response(responseStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
