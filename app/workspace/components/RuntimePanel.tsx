"use client";

/**
 * Runtime panel for CoderXP M3.3.
 *
 * Bottom workspace panel with Terminal, Output, Commands, Agent, and Preview tabs.
 *
 * Layout:
 * ┌ Terminal | Output | Commands | Agent | Preview ─┐
 * │  [tab content]                                   │
 * └──────────────────────────────────────────────────┘
 *
 * Terminal: interactive user/agent shell (xterm.js + WebContainer jsh)
 * Output:   managed CoderXP runtime/process output (read-only)
 * Commands: structured command controller UI
 * Agent:    provider-independent conversation shell (M3.3). No vendor
 *           code here; a transport adapter arrives in M3.9.
 * Preview:  live preview iframe from the runtime server-ready URL
 *
 * Sits below the editor in the ProjectShell layout.
 */

import { useState } from "react";
import { OutputPanel } from "./OutputPanel";
import { PreviewPanel } from "./PreviewPanel";
import { TerminalPanel } from "./TerminalPanel";
import { CommandPanel } from "./CommandPanel";
import { AgentChatPanel } from "./AgentChatPanel";
import type { RuntimeState, OutputLine } from "@/lib/workspace/runtime";
import type { CommandResult } from "@/lib/workspace/command-controller";
import type { AgentMessage } from "@/lib/workspace/agent-protocol";
import type {
  AgentApprovalRequest,
  AgentPermissionMode,
} from "@/lib/workspace/agent-permissions";

type PanelTab = "terminal" | "output" | "preview" | "commands" | "agent";

interface RuntimePanelProps {
  /** Output lines from the runtime process. */
  output: OutputLine[];
  /** Preview URL from the real server-ready event, or null. */
  previewUrl: string | null;
  /** Current runtime state. */
  runtimeState: RuntimeState;
  /** Whether a Run is in progress. */
  isStarting: boolean;
  /** Whether the runtime is running. */
  isRunning: boolean;
  /** Key to force iframe refresh. */
  previewKey: number;
  /** Called when Run is clicked. */
  onRun: () => void;
  /** Called when Stop is clicked. */
  onStop: () => void;
  /** Called when Refresh is clicked. */
  onRefresh: () => void;
  /** Command results from the command controller. */
  commands: CommandResult[];
  /** Whether any command is running. */
  commandsRunning: boolean;
  /** Run a structured command. */
  onCommandRun: (input: string) => Promise<void>;
  /** Cancel a command by ID. */
  onCommandCancel: (processId: string) => void;
  /** Clear completed commands. */
  onCommandClear: () => void;
  /** Agent conversation transcript. */
  chatMessages: AgentMessage[];
  /** True while an assistant turn is streaming. */
  chatStreaming: boolean;
  /** True when an agent transport is configured. */
  chatConnected: boolean;
  /** Append a user message and start a turn. */
  onChatSend: (text: string) => void;
  /** Abort the active agent stream. */
  onChatCancel: () => void;
  /** Start a new conversation. */
  onChatClear: () => void;
  /** M3.6 permission state, passed straight through to the agent panel. */
  permissionMode: AgentPermissionMode;
  onPermissionModeChange: (mode: AgentPermissionMode) => void;
  pendingApprovals: AgentApprovalRequest[];
  onApproveRequest: (approvalId: string) => void;
  onDenyRequest: (approvalId: string) => void;
}

export function RuntimePanel({
  output,
  previewUrl,
  runtimeState,
  isStarting,
  isRunning,
  previewKey,
  onRun,
  onStop,
  onRefresh,
  commands,
  commandsRunning,
  onCommandRun,
  onCommandCancel,
  onCommandClear,
  chatMessages,
  chatStreaming,
  chatConnected,
  onChatSend,
  onChatCancel,
  onChatClear,
  permissionMode,
  onPermissionModeChange,
  pendingApprovals,
  onApproveRequest,
  onDenyRequest,
}: RuntimePanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>("preview");

  return (
    <div className="flex flex-col h-full border-t border-gray-800">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-800 bg-[#0d0e10]">
        <button
          onClick={() => setActiveTab("terminal")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "terminal"
              ? "text-gray-200 border-b-2 border-cyan-500"
              : "text-gray-500 hover:text-gray-400"
          }`}
        >
          Terminal
        </button>
        <button
          onClick={() => setActiveTab("output")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "output"
              ? "text-gray-200 border-b-2 border-cyan-500"
              : "text-gray-500 hover:text-gray-400"
          }`}
        >
          Output
        </button>
        <button
          onClick={() => setActiveTab("commands")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "commands"
              ? "text-gray-200 border-b-2 border-cyan-500"
              : "text-gray-500 hover:text-gray-400"
          }`}
        >
          Commands
        </button>
        <button
          onClick={() => setActiveTab("agent")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "agent"
              ? "text-gray-200 border-b-2 border-cyan-500"
              : "text-gray-500 hover:text-gray-400"
          }`}
        >
          Agent
        </button>
        <button
          onClick={() => setActiveTab("preview")}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "preview"
              ? "text-gray-200 border-b-2 border-cyan-500"
              : "text-gray-500 hover:text-gray-400"
          }`}
        >
          Preview
        </button>
        {/* Runtime status indicator */}
        <div className="ml-auto px-3">
          <RuntimeStatusIndicator state={runtimeState} />
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "terminal" && (
          <TerminalPanel active={true} />
        )}
        {activeTab === "output" && (
          <OutputPanel output={output} />
        )}
        {activeTab === "commands" && (
          <CommandPanel
            commands={commands}
            isRunning={commandsRunning}
            onRun={onCommandRun}
            onCancel={onCommandCancel}
            onClear={onCommandClear}
          />
        )}
        {activeTab === "agent" && (
          <AgentChatPanel
            messages={chatMessages}
            isStreaming={chatStreaming}
            isConnected={chatConnected}
            onSend={onChatSend}
            onCancel={onChatCancel}
            onClear={onChatClear}
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            pendingApprovals={pendingApprovals}
            onApproveRequest={onApproveRequest}
            onDenyRequest={onDenyRequest}
          />
        )}
        {activeTab === "preview" && (
          <PreviewPanel
            previewUrl={previewUrl}
            runtimeState={runtimeState}
            isStarting={isStarting}
            isRunning={isRunning}
            previewKey={previewKey}
            onRun={onRun}
            onStop={onStop}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime status indicator
// ---------------------------------------------------------------------------

function RuntimeStatusIndicator({ state }: { state: RuntimeState }) {
  const colors: Record<RuntimeState, string> = {
    idle: "text-gray-500",
    booting: "text-amber-400",
    mounting: "text-amber-400",
    starting: "text-amber-400",
    installing: "text-amber-400",
    running: "text-green-400",
    stopping: "text-gray-500",
    error: "text-red-400",
  };

  return (
    <span className={`text-xs ${colors[state]}`}>
      {state}
    </span>
  );
}
