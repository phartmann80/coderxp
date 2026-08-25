/**
 * Client HTTP Streaming Transport for CoderXP Agent Orchestrator.
 *
 * Implements the provider-independent AgentTransport interface from M3.8.
 * Interacts solely with the canonical /api/agent/stream endpoint using
 * canonical Server-Sent Events (SSE).
 *
 * Contains zero provider SDKs, zero vendor-specific wire types, and
 * guarantees credentials are never exposed to logs or error objects.
 */

import type {
  AgentTransport,
  AgentTransportRequest,
  AgentTransportEvent,
} from "./agent-transport-types";

export type HttpCredentialMode = "browser-byok" | "server-owned";

export interface HttpAgentTransportOptions {
  endpoint?: string;
  /** Required when credentialMode is browser-byok. Ignored for server-owned. */
  getApiKey?: () => string | null;
  /** Optional model id appended to the JSON body (server validates allowlist). */
  getModel?: () => string | null;
  /**
   * browser-byok: send x-coderxp-byok-key (Anthropic mode).
   * server-owned: never send BYOK header (Logicc mode).
   */
  credentialMode?: HttpCredentialMode;
}

export class HttpAgentTransport implements AgentTransport {
  private readonly endpoint: string;
  private readonly getApiKey: (() => string | null) | undefined;
  private readonly getModel: (() => string | null) | undefined;
  private readonly credentialMode: HttpCredentialMode;

  constructor(options: HttpAgentTransportOptions) {
    this.endpoint = options.endpoint ?? "/api/agent/stream";
    this.getApiKey = options.getApiKey;
    this.getModel = options.getModel;
    this.credentialMode = options.credentialMode ?? "browser-byok";
  }

  async *send(
    request: AgentTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<AgentTransportEvent> {
    const turnId = request.turnId;
    const requestId = request.requestId;

    let key: string | null = null;
    if (this.credentialMode === "browser-byok") {
      key = this.getApiKey?.() ?? null;
      if (!key || typeof key !== "string" || key.trim().length === 0) {
        yield {
          type: "turn-started",
          eventId: `evt-${turnId}-0`,
          sequence: 0,
          requestId,
          turnId,
          timestamp: Date.now(),
        };
        yield {
          type: "transport-error",
          eventId: `evt-${turnId}-1`,
          sequence: 1,
          requestId,
          turnId,
          code: "INVALID_CREDENTIALS",
          message: "An API key is required. Please set your BYOK credential.",
        };
        return;
      }
    }

    if (signal.aborted) {
      yield {
        type: "turn-started",
        eventId: `evt-${turnId}-0`,
        sequence: 0,
        requestId,
        turnId,
        timestamp: Date.now(),
      };
      yield {
        type: "transport-cancelled",
        eventId: `evt-${turnId}-1`,
        sequence: 1,
        requestId,
        turnId,
        reason: "Request aborted before dispatch.",
      };
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.credentialMode === "browser-byok" && key) {
      headers["x-coderxp-byok-key"] = key.trim();
    }

    const model = this.getModel?.() ?? null;
    const bodyPayload =
      model && model.trim().length > 0
        ? { ...request, model: model.trim() }
        : request;

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
        signal,
      });
    } catch (err: unknown) {
      if (signal.aborted) {
        yield {
          type: "turn-started",
          eventId: `evt-${turnId}-0`,
          sequence: 0,
          requestId,
          turnId,
          timestamp: Date.now(),
        };
        yield {
          type: "transport-cancelled",
          eventId: `evt-${turnId}-1`,
          sequence: 1,
          requestId,
          turnId,
          reason: "Request cancelled by user.",
        };
        return;
      }

      yield {
        type: "turn-started",
        eventId: `evt-${turnId}-0`,
        sequence: 0,
        requestId,
        turnId,
        timestamp: Date.now(),
      };
      yield {
        type: "transport-error",
        eventId: `evt-${turnId}-1`,
        sequence: 1,
        requestId,
        turnId,
        code: "NETWORK_ERROR",
        message: "Failed to connect to agent streaming endpoint.",
      };
      return;
    }

    if (!response.ok) {
      let errorCode = "HTTP_ERROR";
      let errorMsg = `Server returned HTTP ${response.status}.`;
      try {
        const errJson = (await response.json()) as { errorCode?: string; message?: string };
        if (errJson.errorCode) errorCode = errJson.errorCode;
        if (errJson.message) errorMsg = errJson.message;
      } catch {
        // Fallback to generic status text
      }

      yield {
        type: "turn-started",
        eventId: `evt-${turnId}-0`,
        sequence: 0,
        requestId,
        turnId,
        timestamp: Date.now(),
      };
      yield {
        type: "transport-error",
        eventId: `evt-${turnId}-1`,
        sequence: 1,
        requestId,
        turnId,
        code: errorCode,
        message: errorMsg,
      };
      return;
    }

    if (!response.body) {
      yield {
        type: "turn-started",
        eventId: `evt-${turnId}-0`,
        sequence: 0,
        requestId,
        turnId,
        timestamp: Date.now(),
      };
      yield {
        type: "transport-error",
        eventId: `evt-${turnId}-1`,
        sequence: 1,
        requestId,
        turnId,
        code: "PROTOCOL_ERROR",
        message: "Empty response body received from stream.",
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminalReceived = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr) as AgentTransportEvent;
              if (
                event.type === "turn-completed" ||
                event.type === "transport-error" ||
                event.type === "transport-cancelled"
              ) {
                terminalReceived = true;
              }
              yield event;
              if (terminalReceived) {
                return;
              }
            } catch {
              yield {
                type: "transport-error",
                eventId: `evt-${turnId}-err`,
                sequence: 9999,
                requestId,
                turnId,
                code: "PROTOCOL_ERROR",
                message: "Failed to parse transport event JSON.",
              };
              return;
            }
          }
        }
      }

      if (!terminalReceived) {
        yield {
          type: "transport-error",
          eventId: `evt-${turnId}-premature`,
          sequence: 9999,
          requestId,
          turnId,
          code: "UPSTREAM_PREMATURE_CLOSE",
          message: "Stream finished without a canonical terminal event.",
        };
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        if (!terminalReceived) {
          yield {
            type: "transport-cancelled",
            eventId: `evt-${turnId}-cancelled`,
            sequence: 9999,
            requestId,
            turnId,
            reason: "Stream cancelled by user.",
          };
        }
      } else {
        if (!terminalReceived) {
          yield {
            type: "transport-error",
            eventId: `evt-${turnId}-stream-err`,
            sequence: 9999,
            requestId,
            turnId,
            code: "STREAM_READ_ERROR",
            message: "Error encountered while reading stream.",
          };
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Safe disposal
      }
    }
  }
}
