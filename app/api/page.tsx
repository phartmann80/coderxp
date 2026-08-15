import type { Metadata } from "next";
import { Code2, Key, Shield, Server } from "lucide-react";

export const metadata: Metadata = {
  title: "API Platform | CoderXP",
  description:
    "Developer platform specifications for programmatic workspace generation, key management, and execution hooks.",
  alternates: {
    canonical: "/api",
  },
};

export default function ApiPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 md:py-16 space-y-12">
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <span className="text-xs font-mono text-accent-cyan uppercase tracking-widest px-2.5 py-1 rounded bg-accent-cyan/10 border border-accent-cyan/20">
          Developer Platform
        </span>
        <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
          CoderXP API Specification
        </h1>
        <p className="text-sm sm:text-base text-gray-400">
          Planned programmatic interfaces for workspace generation, execution hooks, and model gateway management.
        </p>
      </div>

      <div className="glass-panel p-8 rounded-2xl space-y-6">
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-white font-mono">REST & WebSocket Endpoints (Planned)</h2>
          <p className="text-xs text-gray-300">
            CoderXP will expose typed APIs for orchestrating headless sessions, managing encrypted BYOK vault entries, and streaming terminal output over WebSockets.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-obsidian-deep border border-titanium-border font-mono text-xs text-gray-300">
          <p className="text-accent-cyan">{"// Milestone 5 Planned Endpoint"}</p>
          <p className="text-white mt-1">POST /v1/workspaces/orchestrate</p>
          <p className="text-gray-400 mt-1">Content-Type: application/json</p>
        </div>
      </div>
    </div>
  );
}
