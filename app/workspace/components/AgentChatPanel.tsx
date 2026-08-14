"use client";

/**
 * Agent chat panel for CoderXP M3.3.
 *
 * Renders the provider-independent transcript and the composer.
 *
 * - Multiline composer: Enter sends, Shift+Enter inserts a newline.
 * - Structured blocks render through small dedicated renderers.
 * - Inline code and fenced code are parsed by hand; there is no Markdown
 *   dependency and no dangerouslySetInnerHTML anywhere in this file.
 * - When no transport is connected, the panel says so and no reply is
 *   fabricated. The provider adapter lands in M3.9.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square, Plus } from "lucide-react";
import {
  AGENT_NOT_CONNECTED_MESSAGE,
  type AgentBlock,
  type AgentMessage,
} from "@/lib/workspace/agent-protocol";

/** Composer height ceiling so the workspace layout does not jump. */
const COMPOSER_MAX_HEIGHT_PX = 120;

interface AgentChatPanelProps {
  /** Transcript for the open project. */
  messages: AgentMessage[];
  /** True while an assistant turn is streaming. */
  isStreaming: boolean;
  /** True when a transport is configured. */
  isConnected: boolean;
  /** Append a user message and start a turn. */
  onSend: (text: string) => void;
  /** Abort the active stream. */
  onCancel: () => void;
  /** Start a new conversation. */
  onClear: () => void;
}

// ---------------------------------------------------------------------------
// Text rendering — plain text, inline code, fenced code. No HTML injection.
// ---------------------------------------------------------------------------

type TextSegment =
  | { kind: "plain"; text: string }
  | { kind: "inline-code"; text: string }
  | { kind: "fence"; text: string; lang: string };

/** Splits a body into fenced-code and non-fenced segments. */
function splitFences(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const fence = /```([\w-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "plain", text: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "fence", lang: match[1] ?? "", text: match[2] ?? "" });
    cursor = match.index + match[0].length;
  }

  // An unterminated fence stays plain text rather than swallowing the rest.
  if (cursor < text.length) {
    segments.push({ kind: "plain", text: text.slice(cursor) });
  }
  return segments;
}

/** Splits a non-fenced run into plain and inline-code segments. */
function splitInlineCode(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const inline = /`([^`\n]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inline.exec(text)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "plain", text: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "inline-code", text: match[1] ?? "" });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "plain", text: text.slice(cursor) });
  }
  return segments;
}

function AgentText({ text }: { text: string }) {
  const segments = useMemo(() => {
    return splitFences(text).flatMap((segment) =>
      segment.kind === "plain" ? splitInlineCode(segment.text) : [segment],
    );
  }, [text]);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "fence") {
          return (
            <pre
              key={index}
              className="my-1 px-2 py-1.5 overflow-x-auto text-xs text-gray-200 bg-gray-900 border border-gray-800 rounded"
            >
              {segment.lang && (
                <span className="block mb-1 text-xs text-gray-600">{segment.lang}</span>
              )}
              <code className="whitespace-pre">{segment.text}</code>
            </pre>
          );
        }
        if (segment.kind === "inline-code") {
          return (
            <code
              key={index}
              className="px-1 py-0.5 text-xs text-cyan-300 bg-gray-900 border border-gray-800 rounded"
            >
              {segment.text}
            </code>
          );
        }
        return (
          <span key={index} className="whitespace-pre-wrap break-words">
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Structured block rendering
// ---------------------------------------------------------------------------

function BlockChip({ label, tone }: { label: string; tone: string }) {
  return <span className={`text-xs uppercase tracking-wide ${tone}`}>{label}</span>;
}

function AgentBlockView({ block }: { block: AgentBlock }) {
  switch (block.kind) {
    case "text":
      return (
        <p className="text-xs text-gray-300">
          <AgentText text={block.text} />
        </p>
      );

    case "command-started":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip label="run" tone="text-cyan-500" />
          <code className="text-xs text-gray-300 break-all">{block.command}</code>
        </div>
      );

    case "command-output":
      return (
        <pre
          className={`px-2 py-1 overflow-x-auto text-xs whitespace-pre-wrap break-words ${
            block.stream === "stderr" ? "text-red-300" : "text-gray-400"
          }`}
        >
          {block.chunk}
        </pre>
      );

    case "command-completed":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip
            label={block.cancelled ? "cancelled" : "exit"}
            tone={block.exitCode === 0 ? "text-green-500" : "text-red-400"}
          />
          <span className="text-xs text-gray-500">
            {block.cancelled ? "command cancelled" : `code ${block.exitCode ?? "?"}`}
          </span>
        </div>
      );

    case "file-read":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip label="read" tone="text-gray-500" />
          <code className="text-xs text-gray-400 break-all">{block.path}</code>
          {block.bytes !== undefined && (
            <span className="text-xs text-gray-600">{block.bytes} B</span>
          )}
        </div>
      );

    case "file-modified":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip label={block.change} tone="text-amber-500" />
          <code className="text-xs text-gray-400 break-all">{block.path}</code>
        </div>
      );

    case "tool-call":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip label="tool" tone="text-violet-400" />
          <code className="text-xs text-gray-300 break-all">{block.name}</code>
        </div>
      );

    case "tool-result":
      return (
        <pre
          className={`px-2 py-1 overflow-x-auto text-xs whitespace-pre-wrap break-words ${
            block.isError ? "text-red-300" : "text-gray-400"
          }`}
        >
          {block.output}
        </pre>
      );

    case "approval-requested":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip label="approval" tone="text-amber-400" />
          <span className="text-xs text-gray-300">{block.summary}</span>
        </div>
      );

    case "error":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip label="error" tone="text-red-500" />
          <span className="text-xs text-red-300 break-words">{block.message}</span>
        </div>
      );

    case "cancellation":
      return (
        <div className="flex items-baseline gap-2">
          <BlockChip label="cancelled" tone="text-gray-500" />
          <span className="text-xs text-gray-500">{block.reason}</span>
        </div>
      );
  }
}

const ROLE_LABEL: Record<AgentMessage["role"], string> = {
  user: "you",
  assistant: "agent",
  system: "system",
  tool: "tool",
};

const ROLE_TONE: Record<AgentMessage["role"], string> = {
  user: "text-cyan-400",
  assistant: "text-violet-400",
  system: "text-amber-400",
  tool: "text-gray-500",
};

function MessageView({ message }: { message: AgentMessage }) {
  return (
    <div className="border-b border-gray-800/50 px-3 py-1.5">
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`text-xs ${ROLE_TONE[message.role]}`}>
          {ROLE_LABEL[message.role]}
        </span>
        <span className="text-xs text-gray-700">
          {new Date(message.createdAt).toLocaleTimeString()}
        </span>
        {message.status === "streaming" && (
          <span className="text-xs text-gray-600">streaming…</span>
        )}
        {message.status === "cancelled" && (
          <span className="text-xs text-gray-600">cancelled</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {message.content.map((block) => (
          <AgentBlockView key={block.id} block={block} />
        ))}
        {message.content.length === 0 && message.status === "pending" && (
          <span className="text-xs text-gray-600 italic">waiting…</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function AgentChatPanel({
  messages,
  isStreaming,
  isConnected,
  onSend,
  onCancel,
  onClear,
}: AgentChatPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Grow with content up to the ceiling, then scroll inside the composer.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  }, [input, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends. Shift+Enter falls through so the textarea inserts a newline.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col h-full bg-[#0a0b0d]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900/50">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Agent</span>
        <span className="text-xs text-gray-600">
          {isStreaming ? "streaming" : isConnected ? "ready" : "not connected"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {isStreaming && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1 px-1.5 py-1 text-xs text-red-400 hover:text-red-300 transition-colors"
              title="Stop the current response"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={onClear}
              className="flex items-center gap-1 px-1.5 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              title="Start a new conversation"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          )}
        </div>
      </div>

      {/* Truthful connection state — never a fabricated response */}
      {!isConnected && (
        <div className="px-3 py-1.5 border-b border-gray-800/60 bg-gray-900/30">
          <p className="text-xs text-gray-500">
            {AGENT_NOT_CONNECTED_MESSAGE}. Messages stay local and no
            completions are generated.
          </p>
        </div>
      )}

      {/* Transcript */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-xs text-gray-600 italic px-3 py-2">
            No messages yet.
          </p>
        ) : (
          messages.map((message) => <MessageView key={message.id} message={message} />)
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-1.5 px-3 py-1.5 border-t border-gray-800 bg-gray-900/50">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message the agent — Enter to send, Shift+Enter for a new line"
          style={{ maxHeight: COMPOSER_MAX_HEIGHT_PX }}
          className="flex-1 px-2 py-1 text-xs text-gray-100 bg-gray-800 border border-gray-700 rounded resize-none overflow-y-auto focus:outline-none focus:border-cyan-600"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="flex items-center gap-1 px-2 py-1 text-xs text-cyan-400 border border-cyan-700/50 rounded hover:bg-cyan-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Send message"
        >
          <Send className="w-3 h-3" />
          Send
        </button>
      </div>
    </div>
  );
}
