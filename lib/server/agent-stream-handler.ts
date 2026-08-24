/**
 * Server-only agent stream handler for CoderXP M3.9.
 *
 * Production binds fetch/clock/timers to the Node runtime. Tests bind the same
 * handler to a deterministic fake upstream. The Anthropic origin is fixed here
 * and is never taken from the HTTP request or the browser.
 */

import {
  validateAndTranslateRequest,
  AnthropicStreamTranslator,
  SERVER_RESOURCE_LIMITS,
} from "./agent-anthropic-adapter";
import type { AgentTransportRequest, AgentTransportEvent } from "../workspace/agent-transport-types";

export const PRODUCTION_ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const PRODUCTION_ANTHROPIC_VERSION = "2023-06-01";
export const MAX_GLOBAL_CONCURRENT_STREAMS = 50;

export type AgentStreamLimits = {
  maxRequestBodyBytes: number;
  streamTimeoutMs: number;
  connectTimeoutMs: number;
};

export type FetchUpstream = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<Response>;

export interface ConcurrencyGate {
  tryAcquire(): boolean;
  release(): void;
  active(): number;
}

export function createConcurrencyGate(maxConcurrent: number): ConcurrencyGate {
  let active = 0;
  return {
    tryAcquire(): boolean {
      if (active >= maxConcurrent) return false;
      active += 1;
      return true;
    },
    release(): void {
      active = Math.max(0, active - 1);
    },
    active(): number {
      return active;
    },
  };
}

export interface AgentStreamHandlerDeps {
  fetchUpstream: FetchUpstream;
  clock: () => number;
  scheduleTimeout: (fn: () => void, ms: number) => unknown;
  cancelTimeout: (id: unknown) => void;
  limits: AgentStreamLimits;
  concurrency: ConcurrencyGate;
}

type AbortCause = "none" | "client" | "connect-timeout" | "stream-timeout";

function isHeaderSafeApiKey(key: string): boolean {
  if (typeof key !== "string" || key.trim().length === 0) return false;
  if (key.length > 256) return false;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 33 || code > 126) return false;
  }
  return true;
}

function jsonError(errorCode: string, message: string, status: number): Response {
  return Response.json({ errorCode, message }, { status });
}

export function createAgentStreamHandler(
  deps: AgentStreamHandlerDeps,
): (req: Request) => Promise<Response> {
  return async function handleAgentStream(req: Request): Promise<Response> {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonError("INVALID_REQUEST", "Content-Type must be application/json.", 400);
    }

    let byokKey = req.headers.get("x-coderxp-byok-key")?.trim() ?? "";
    if (!isHeaderSafeApiKey(byokKey)) {
      byokKey = "";
      return jsonError(
        "INVALID_CREDENTIALS",
        "A valid Anthropic API key is required. Please provide your BYOK credential.",
        401,
      );
    }

    if (!deps.concurrency.tryAcquire()) {
      byokKey = "";
      return jsonError("RATE_LIMITED", "Server capacity reached. Please try again shortly.", 429);
    }

    let acquired = true;
    const releaseConcurrency = () => {
      if (acquired) {
        acquired = false;
        deps.concurrency.release();
      }
    };

    let rawBodyText: string;
    try {
      rawBodyText = await req.text();
    } catch {
      releaseConcurrency();
      byokKey = "";
      return jsonError("INVALID_REQUEST", "Failed to read request body.", 400);
    }

    if (Buffer.byteLength(rawBodyText, "utf8") > deps.limits.maxRequestBodyBytes) {
      releaseConcurrency();
      byokKey = "";
      return jsonError("REQUEST_TOO_LARGE", "Request body exceeds maximum limit (1 MB).", 413);
    }

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(rawBodyText);
    } catch {
      releaseConcurrency();
      byokKey = "";
      return jsonError("INVALID_REQUEST", "Malformed JSON payload.", 400);
    }

    const transportReq = parsedBody as unknown as AgentTransportRequest;
    const translationResult = validateAndTranslateRequest(transportReq, {
      model: typeof parsedBody.model === "string" ? parsedBody.model : undefined,
      temperature: typeof parsedBody.temperature === "number" ? parsedBody.temperature : undefined,
      maxTokens: typeof parsedBody.maxTokens === "number" ? parsedBody.maxTokens : undefined,
    });

    if (!translationResult.ok) {
      releaseConcurrency();
      byokKey = "";
      return jsonError(translationResult.errorCode, translationResult.message, translationResult.status);
    }

    const requestId = transportReq.requestId || `req-${deps.clock()}`;
    const turnId = transportReq.turnId || `turn-${deps.clock()}`;
    const abortController = new AbortController();
    let abortCause: AbortCause = "none";

    const markClientAbort = () => {
      if (abortCause === "none") abortCause = "client";
      abortController.abort();
    };

    if (req.signal.aborted) {
      markClientAbort();
    } else {
      req.signal.addEventListener("abort", markClientAbort);
    }

    const encoder = new TextEncoder();
    const upstreamBody = JSON.stringify(translationResult.body);
    const apiKeyHeader = byokKey;
    byokKey = "";

    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let isClosed = false;
        let connectInFlight = true;
        let connectTimer: unknown;
        let streamTimer: unknown;

        const clearConnectTimer = () => {
          if (connectTimer !== undefined) {
            deps.cancelTimeout(connectTimer);
            connectTimer = undefined;
          }
        };

        const clearStreamTimer = () => {
          if (streamTimer !== undefined) {
            deps.cancelTimeout(streamTimer);
            streamTimer = undefined;
          }
        };

        const safeEnqueue = (event: AgentTransportEvent) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Client cancelled the readable stream.
          }
        };

        const closeStream = () => {
          if (isClosed) return;
          isClosed = true;
          clearConnectTimer();
          clearStreamTimer();
          releaseConcurrency();
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        };

        const translator = new AnthropicStreamTranslator(requestId, turnId, (event) => {
          safeEnqueue(event);
        });

        const armStreamTimer = () => {
          clearStreamTimer();
          streamTimer = deps.scheduleTimeout(() => {
            if (translator.isTerminalCommitted()) return;
            abortCause = "stream-timeout";
            translator.emitTerminalError("PROVIDER_TIMEOUT", "Streaming request timed out.");
            abortController.abort();
            closeStream();
          }, deps.limits.streamTimeoutMs);
        };

        connectTimer = deps.scheduleTimeout(() => {
          if (!connectInFlight) return;
          if (abortCause !== "none") return;
          if (translator.isTerminalCommitted()) return;
          abortCause = "connect-timeout";
          abortController.abort();
        }, deps.limits.connectTimeoutMs);

        try {
          const upstreamResponse = await deps.fetchUpstream(PRODUCTION_ANTHROPIC_MESSAGES_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKeyHeader,
              "anthropic-version": PRODUCTION_ANTHROPIC_VERSION,
            },
            body: upstreamBody,
            signal: abortController.signal,
          });

          connectInFlight = false;
          clearConnectTimer();

          if (abortCause === "connect-timeout") {
            translator.emitTerminalError("PROVIDER_TIMEOUT", "Connection to provider timed out.");
            closeStream();
            return;
          }

          armStreamTimer();

          if (!upstreamResponse.ok) {
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
                  const eventObj = JSON.parse(dataStr) as Record<string, unknown>;
                  translator.handleAnthropicEvent(eventObj);
                } catch {
                  translator.emitTerminalError(
                    "UPSTREAM_PROTOCOL_ERROR",
                    "Failed to parse upstream event data.",
                  );
                  break;
                }
              }
            }

            if (translator.isTerminalCommitted()) {
              break;
            }
          }

          if (!translator.isTerminalCommitted()) {
            translator.emitTerminalError(
              "UPSTREAM_PREMATURE_CLOSE",
              "Upstream stream closed without a terminal completion event.",
            );
          }
        } catch {
          if (!translator.isTerminalCommitted()) {
            if (abortCause === "connect-timeout") {
              translator.emitTerminalError("PROVIDER_TIMEOUT", "Connection to provider timed out.");
            } else if (abortCause === "stream-timeout") {
              translator.emitTerminalError("PROVIDER_TIMEOUT", "Streaming request timed out.");
            } else if (abortCause === "client" || abortController.signal.aborted) {
              translator.emitTerminalCancelled("Request cancelled by client.");
            } else {
              translator.emitTerminalError(
                "PROVIDER_UNAVAILABLE",
                "Failed to establish connection with upstream provider.",
              );
            }
          }
        } finally {
          connectInFlight = false;
          closeStream();
        }
      },
      cancel() {
        if (abortCause === "none") abortCause = "client";
        abortController.abort();
        releaseConcurrency();
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
  };
}

export const defaultStreamLimits: AgentStreamLimits = {
  maxRequestBodyBytes: SERVER_RESOURCE_LIMITS.maxRequestBodyBytes,
  streamTimeoutMs: SERVER_RESOURCE_LIMITS.streamTimeoutMs,
  connectTimeoutMs: SERVER_RESOURCE_LIMITS.connectTimeoutMs,
};
