"use client";

/**
 * Agent chat panel for CoderXP M3.3.
 *
 * A real but non-AI chat shell in the workspace runtime panel.
 *
 * - Message list + composer
 * - Local component/hook state only (no network, no provider keys, no LLM)
 * - Sending a user message appends it
 * - Agent replies are not implemented (M3.5 HOLD)
 * - Idle/unwired empty-agent state is shown instead of fake completions
 *
 * M3.5 HOLD: do not use CommandOwner "agent" to run an agent loop.
 * M3.5 will connect this panel to a provider-backed agent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import type { AgentChatMessage } from "../hooks/useAgentChat";

interface AgentChatPanelProps {
  /** Local chat messages for the open project. */
  messages: AgentChatMessage[];
  /** Append a user message. */
  onSend: (text: string) => void;
  /** Clear the local transcript. */
  onClear: () => void;
}

export function AgentChatPanel({ messages, onSend, onClear }: AgentChatPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  }, [input, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="flex flex-col h-full bg-[#0a0b0d]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900/50">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Agent</span>
        <span className="text-xs text-gray-600">idle — not wired</span>
        {messages.length > 0 && (
          <button
            onClick={onClear}
            className="ml-auto flex items-center gap-1 px-1.5 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="Clear transcript"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Unwired banner — M3.5 HOLD, not a fake completion */}
      <div className="px-3 py-1.5 border-b border-gray-800/60 bg-gray-900/30">
        <p className="text-xs text-gray-500">
          Agent replies are not connected. Messages stay local until M3.5
          wires a provider. No completions are generated.
        </p>
      </div>

      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-xs text-gray-600 italic px-3 py-2">
            Compose a message to keep a local transcript. The agent is idle
            and unwired — it will not reply.
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="border-b border-gray-800/50 px-3 py-1.5">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs text-cyan-400">you</span>
                <span className="text-xs text-gray-700">
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-gray-300 whitespace-pre-wrap break-words">
                {msg.text}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-gray-800 bg-gray-900/50">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a local message…"
          className="flex-1 px-2 py-1 text-xs text-gray-100 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-cyan-600"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="flex items-center gap-1 px-2 py-1 text-xs text-cyan-400 border border-cyan-700/50 rounded hover:bg-cyan-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Send local message"
        >
          <Send className="w-3 h-3" />
          Send
        </button>
      </div>
    </div>
  );
}
