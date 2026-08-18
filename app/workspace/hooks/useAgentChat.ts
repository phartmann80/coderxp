"use client";

/**
 * Agent conversation controller for CoderXP M3.3.
 *
 * Owns the provider-independent transcript and the streaming lifecycle.
 * Contains no vendor code, no network calls, and no credentials — the
 * concrete provider adapter arrives in M3.9 behind AgentTransport.
 *
 * Ownership rules:
 * - A generation token is bumped on project switch, on cancel, on clear,
 *   and at the start of each send. Any stream from an older generation is
 *   dropped: it cannot append chunks, finish, or fail a newer turn.
 * - Project switching aborts the active stream, so Project A can never
 *   write into Project B's transcript.
 *
 * When no transport is set, send() records the user message and appends a
 * truthful "Agent provider not connected" error block. No response is
 * fabricated.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_NOT_CONNECTED_MESSAGE,
  type AgentBlock,
  type AgentMessage,
  type AgentTransport,
} from "@/lib/workspace/agent-protocol";
import { projectEventToTranscriptBlocks } from "@/lib/workspace/agent-transcript-projector";
import type { AgentExecutionEvent } from "@/lib/workspace/agent-execution-runtime";

export interface AgentChatApi {
  /** Transcript for the open project, oldest first. */
  messages: AgentMessage[];
  /** True while an assistant turn is streaming. */
  isStreaming: boolean;
  /** True when a transport is configured. */
  isConnected: boolean;
  /** Append a user message and start an assistant turn. */
  send: (text: string) => void;
  /** Abort the active stream and mark the message cancelled. */
  cancel: () => void;
  /** Abort any active stream and start a new conversation. */
  clear: () => void;
  /** Install or remove the transport. Null means not connected. */
  setTransport: (transport: AgentTransport | null) => void;
  /** Project execution runtime events into the active assistant message transcript. */
  handleExecutionEvent: (event: AgentExecutionEvent) => void;
}

/** Appends a text delta to the trailing text block, or starts one. */
function appendTextDelta(content: AgentBlock[], text: string): AgentBlock[] {
  const last = content[content.length - 1];
  if (last && last.kind === "text") {
    const merged: AgentBlock = { ...last, text: last.text + text };
    return [...content.slice(0, -1), merged];
  }
  return [...content, { id: `b-${content.length}`, kind: "text", text }];
}

/** Appends a block, or replaces an existing block with the same id. */
function upsertBlock(content: AgentBlock[], block: AgentBlock): AgentBlock[] {
  const index = content.findIndex((existing) => existing.id === block.id);
  if (index === -1) return [...content, block];
  const next = content.slice();
  next[index] = block;
  return next;
}

/**
 * Conversation state keyed to the open project.
 *
 * The transcript is in-memory only, matching other ephemeral workspace
 * state such as command results. It resets on a real project switch.
 */
export function useAgentChat(projectId: string): AgentChatApi {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const idRef = useRef(0);
  const projectIdRef = useRef(projectId);
  const transportRef = useRef<AgentTransport | null>(null);
  /** Bumped whenever an in-flight turn must stop owning the transcript. */
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** Latest projectId, read inside async streams without re-binding send. */
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;

  const nextId = useCallback((prefix: string) => {
    idRef.current += 1;
    return `${prefix}-${idRef.current}`;
  }, []);

  /** Aborts the active stream and invalidates any stream still running. */
  const invalidateStream = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const setProject = useCallback(() => {
    invalidateStream();
    idRef.current = 0;
    setMessages([]);
  }, [invalidateStream]);

  // Real project switches only. A rerender must not reset the transcript
  // or invalidate an active stream.
  useEffect(() => {
    if (projectIdRef.current === projectId) return;
    projectIdRef.current = projectId;
    setProject();
  }, [projectId, setProject]);

  // Abort any stream still running when the workspace unmounts.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const setTransport = useCallback(
    (transport: AgentTransport | null) => {
      invalidateStream();
      transportRef.current = transport;
      setIsConnected(transport !== null);
    },
    [invalidateStream],
  );

  /** Mutates one message by id, leaving the rest of the transcript intact. */
  const patchMessage = useCallback(
    (messageId: string, patch: (message: AgentMessage) => AgentMessage) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === messageId ? patch(message) : message)),
      );
    },
    [],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // A new turn supersedes anything still streaming.
      invalidateStream();
      const generation = generationRef.current;
      const ownerProjectId = activeProjectRef.current;

      const userMessage: AgentMessage = {
        id: nextId("msg"),
        role: "user",
        content: [{ id: "b-0", kind: "text", text: trimmed }],
        createdAt: Date.now(),
        status: "complete",
      };

      const transport = transportRef.current;

      // No transport: record the truth, do not invent a reply.
      if (!transport) {
        const notice: AgentMessage = {
          id: nextId("msg"),
          role: "system",
          content: [
            { id: "b-0", kind: "error", message: AGENT_NOT_CONNECTED_MESSAGE },
          ],
          createdAt: Date.now(),
          status: "error",
        };
        setMessages((prev) => [...prev, userMessage, notice]);
        return;
      }

      const assistantId = nextId("msg");
      const assistantMessage: AgentMessage = {
        id: assistantId,
        role: "assistant",
        content: [],
        createdAt: Date.now(),
        status: "pending",
      };

      let transcript: AgentMessage[] = [];
      setMessages((prev) => {
        transcript = [...prev, userMessage];
        return [...transcript, assistantMessage];
      });

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      /** True while this turn is still the owner of the transcript. */
      const owns = () =>
        generationRef.current === generation &&
        activeProjectRef.current === ownerProjectId;

      void (async () => {
        try {
          const stream = transport.send(
            { projectId: ownerProjectId, messages: transcript },
            controller.signal,
          );

          for await (const event of stream) {
            // Stale stream from a superseded turn or a switched project.
            if (!owns()) return;

            if (event.type === "text-delta") {
              patchMessage(assistantId, (message) => ({
                ...message,
                status: "streaming",
                content: appendTextDelta(message.content, event.text),
              }));
              continue;
            }

            if (event.type === "block") {
              patchMessage(assistantId, (message) => ({
                ...message,
                status: "streaming",
                content: upsertBlock(message.content, event.block),
              }));
              continue;
            }

            if (event.type === "error") {
              patchMessage(assistantId, (message) => ({
                ...message,
                status: "error",
                content: [
                  ...message.content,
                  { id: `b-${message.content.length}`, kind: "error", message: event.message },
                ],
              }));
              return;
            }

            if (event.type === "done") break;
          }

          if (!owns()) return;
          patchMessage(assistantId, (message) => ({ ...message, status: "complete" }));
        } catch (err) {
          if (!owns()) return;
          const cancelled = controller.signal.aborted;
          patchMessage(assistantId, (message) => ({
            ...message,
            status: cancelled ? "cancelled" : "error",
            content: [
              ...message.content,
              cancelled
                ? {
                    id: `b-${message.content.length}`,
                    kind: "cancellation",
                    reason: "Cancelled",
                  }
                : {
                    id: `b-${message.content.length}`,
                    kind: "error",
                    message: err instanceof Error ? err.message : "Agent stream failed.",
                  },
            ],
          }));
        } finally {
          if (owns()) {
            abortRef.current = null;
            setIsStreaming(false);
          }
        }
      })();
    },
    [invalidateStream, nextId, patchMessage],
  );

  const cancel = useCallback(() => {
    if (!abortRef.current) return;
    invalidateStream();
    setMessages((prev) =>
      prev.map((message) =>
        message.status === "streaming" || message.status === "pending"
          ? {
              ...message,
              status: "cancelled",
              content: [
                ...message.content,
                {
                  id: `b-${message.content.length}`,
                  kind: "cancellation",
                  reason: "Cancelled",
                },
              ],
            }
          : message,
      ),
    );
  }, [invalidateStream]);

  const clear = useCallback(() => {
    invalidateStream();
    idRef.current = 0;
    setMessages([]);
  }, [invalidateStream]);

  const handleExecutionEvent = useCallback(
    (event: AgentExecutionEvent) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== "assistant") return prev;
        const nextContent = projectEventToTranscriptBlocks(last.content, event);
        const updated: AgentMessage = { ...last, content: nextContent };
        return [...prev.slice(0, -1), updated];
      });
    },
    [],
  );

  return {
    messages,
    isStreaming,
    isConnected,
    send,
    cancel,
    clear,
    setTransport,
    handleExecutionEvent,
  };
}
