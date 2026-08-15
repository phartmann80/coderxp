import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Code2, Shield, Terminal, Cpu } from "lucide-react";

export const metadata: Metadata = {
  title: "About Us | CoderXP",
  description:
    "Why we built CoderXP: authentic software engineering workspace, BYOK transparency, and developer-first design.",
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 md:py-16 space-y-12">
      
      {/* Hero */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <span className="text-xs font-mono text-accent-cyan uppercase tracking-widest px-2.5 py-1 rounded bg-accent-cyan/10 border border-accent-cyan/20">
          The Manifesto
        </span>
        <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
          Why We Built CoderXP
        </h1>
        <p className="text-sm sm:text-base text-gray-400">
          AI engineering workspaces should feel like genuine developer environments, not toy demos.
        </p>
      </div>

      {/* Narrative */}
      <div className="glass-panel p-8 rounded-2xl space-y-6 text-sm text-gray-300 leading-relaxed">
        <p>
          Most AI code tools build isolated wrappers that hide compiler errors, inject proprietary lock-in models, and force developers into expensive subscription markups.
        </p>
        <p>
          CoderXP is built on a different premise: give developers raw control, authentic terminal execution, BYOK direct-to-provider routing, and full privacy architecture without hidden tokens.
        </p>
      </div>

      {/* Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl glass-panel space-y-3">
          <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan">
            <Terminal className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-white">Authentic Tooling</h3>
          <p className="text-xs text-gray-400">
            Real terminals, real file diffs, real runtime logs. No mock execution widgets.
          </p>
        </div>

        <div className="p-6 rounded-xl glass-panel space-y-3">
          <div className="w-10 h-10 rounded-lg bg-accent-emerald/10 border border-accent-emerald/20 flex items-center justify-center text-accent-emerald">
            <Shield className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-white">BYOK Transparency</h3>
          <p className="text-xs text-gray-400">
            Bring your own keys from OpenAI, Anthropic, Gemini, DeepSeek, or run local LLMs offline.
          </p>
        </div>
      </div>

    </div>
  );
}
