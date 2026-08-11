"use client";

/**
 * Runtime panel for CoderXP M2 Workspace Alpha.
 *
 * Commit 5 scope: bottom panel with Output and Preview tabs.
 *
 * Layout:
 * ┌ Output | Preview ────────────────────────┐
 * │  [tab content]                          │
 * └─────────────────────────────────────────┘
 *
 * Sits below the editor in the ProjectShell layout.
 */

import { useState } from "react";
import { OutputPanel } from "./OutputPanel";
import { PreviewPanel } from "./PreviewPanel";
import type { RuntimeState, OutputLine } from "@/lib/workspace/runtime";

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
}: RuntimePanelProps) {
  const [activeTab, setActiveTab] = useState<"output" | "preview">("preview");

  return (
    <div className="flex flex-col h-full border-t border-gray-800">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-800 bg-[#0d0e10]">
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
        {activeTab === "output" ? (
          <OutputPanel output={output} />
        ) : (
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

/**
 * Small status indicator showing the current runtime state.
 * Only shows states that correspond to actual runtime work.
 */
function RuntimeStatusIndicator({ state }: { state: RuntimeState }) {
  const colors: Record<RuntimeState, string> = {
    idle: "text-gray-600",
    booting: "text-amber-400",
    mounting: "text-amber-400",
    starting: "text-amber-400",
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
