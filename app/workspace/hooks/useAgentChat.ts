"use client";

/**
 * Agent chat hook for CoderXP M3.3.
 *
 * Local-only chat shell state. No network, no provider keys, no LLM calls.
 *
 * Sending a user message appends it to the list. Agent replies are not
 * implemented (M3.5 HOLD) — callers must show an idle/unwired empty-agent
 * state rather than fake completions.
 *
 * M3.5 HOLD: do not use CommandOwner "agent" to run an agent loop.
 * M3.5 will connect this composer to a provider-backed agent.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Chat roles for the local shell. Agent messages are reserved for M3.5. */
export type AgentChatRole = "user";

/** A single local chat message. */
export interface AgentChatMessage {
  /** Stable local id (not a provider id). */
  id: string;
  /** Message author. M3.3 only produces "user". */
  role: AgentChatRole;
  /** Message body. */
  text: string;
  /** Unix timestamp (ms). */
  createdAt: number;
}

export interface AgentChatApi {
  /** Local message list for the current project. */
  messages: AgentChatMessage[];
  /** Append a user message. No agent reply is generated. */
  send: (text: string) => void;
  /** Clear the local transcript. */
  clear: () => void;
}

/**
 * Local agent-chat state keyed to the open project.
 *
 * Transcript is in-memory only (matches other ephemeral workspace UI
 * state such as command results). It resets on project switch.
 */
export function useAgentChat(projectId: string): AgentChatApi {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const idRef = useRef(0);
  const projectIdRef = useRef(projectId);

  // Reset the local transcript on a real project switch only.
  useEffect(() => {
    if (projectIdRef.current === projectId) return;
    projectIdRef.current = projectId;
    idRef.current = 0;
    setMessages([]);
  }, [projectId]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    idRef.current += 1;
    const message: AgentChatMessage = {
      id: `chat-${idRef.current}`,
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, message]);
    // M3.5 HOLD: no agent reply, no provider call, no CommandOwner "agent" loop.
    // M3.5 will connect this send path to a provider-backed agent.
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, send, clear };
}
