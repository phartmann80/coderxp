import Link from "next/link";
import { Terminal, Layers, Eye, Play, ArrowRight, Info } from "lucide-react";

export default function WorkspacePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12 md:py-16 space-y-12">
      
      {/* Title */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <span className="text-xs font-mono text-accent-cyan uppercase tracking-widest px-2.5 py-1 rounded bg-accent-cyan/10 border border-accent-cyan/20">
          The 3-Panel Signature Workspace
        </span>
        <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
          Heart of CoderXP
        </h1>
        <p className="text-sm sm:text-base text-gray-400">
          Experience an integrated developer OS featuring conversation context on the left, syntax editor and terminal in the center, and live interactive preview on the right.
        </p>
      </div>

      {/* Capability Status Banner */}
      <div className="p-4 rounded-xl bg-obsidian-card border border-titanium-border flex items-start gap-3 text-xs text-gray-300">
        <Info className="w-5 h-5 text-accent-cyan shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white font-mono uppercase tracking-wider block">Milestone 1 Preview Gate</span>
          The public website design language is currently under review. The interactive 3-panel execution workspace will become operational in Milestone 4 following visual approval.
        </div>
      </div>

      {/* Mock Workspace Visual Architecture Showcase */}
      <div className="rounded-xl glass-panel-elevated p-6 space-y-6 border border-titanium-bright/40">
        <div className="flex items-center justify-between border-b border-titanium-border pb-4 font-mono text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <span className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="ml-2 text-white font-semibold">coderxp-workspace-architecture</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 text-[11px]">
            Planned Milestone 4
          </span>
        </div>

        {/* 3 Panels Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 h-96">
          
          {/* Left Panel */}
          <div className="md:col-span-3 p-4 rounded-lg bg-obsidian-deep border border-titanium-border space-y-3 font-mono text-xs flex flex-col justify-between">
            <div>
              <p className="text-accent-cyan font-semibold mb-2">1. Left Panel</p>
              <p className="text-gray-400 text-[11px]">Conversation History, Project Context, Multimodal attachments, Voice Waveform input, Model selector.</p>
            </div>
            <div className="p-2 rounded bg-obsidian-card text-[11px] text-gray-400 border border-titanium-border/60">
              Model: Claude 3.5 Sonnet (BYOK)
            </div>
          </div>

          {/* Center Panel */}
          <div className="md:col-span-6 p-4 rounded-lg bg-obsidian-deep border border-titanium-border space-y-3 font-mono text-xs flex flex-col justify-between">
            <div>
              <p className="text-accent-emerald font-semibold mb-2">2. Center Panel</p>
              <p className="text-gray-400 text-[11px]">Multi-tab syntax editor, AST file diff viewer, and real terminal output log stream.</p>
            </div>
            <div className="p-2 rounded bg-obsidian-card text-[11px] text-emerald-400 border border-titanium-border/60">
              Planned: authentic terminal output stream
            </div>
          </div>

          {/* Right Panel */}
          <div className="md:col-span-3 p-4 rounded-lg bg-obsidian-deep border border-titanium-border space-y-3 font-mono text-xs flex flex-col justify-between">
            <div>
              <p className="text-accent-amber font-semibold mb-2">3. Right Panel</p>
              <p className="text-gray-400 text-[11px]">Interactive sandboxed live preview runner, viewport toggles (Desktop, Mobile), shareable preview URL.</p>
            </div>
            <div className="p-2 rounded bg-obsidian-card text-[11px] text-gray-400 border border-titanium-border/60">
              https://coderxp.pro/preview/demo
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
