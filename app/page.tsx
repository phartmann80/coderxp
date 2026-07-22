import Link from "next/link";
import { HeroVideo } from "@/components/landing/HeroVideo";
import { 
  Terminal, 
  Key, 
  Cpu, 
  ShieldCheck, 
  Zap, 
  Code2, 
  Layers, 
  ArrowRight, 
  CheckCircle2, 
  Lock, 
  Globe, 
  Server,
  Sparkles,
  Info
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-16 md:gap-24 py-8 md:py-12">
      
      {/* HERO SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 md:pt-8 text-center space-y-8">
        
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-obsidian-card border border-titanium-border text-xs text-gray-300 font-mono">
          <Sparkles className="w-3.5 h-3.5 text-accent-cyan" />
          <span>Milestone 1 Visual Candidate & Architecture</span>
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white max-w-5xl mx-auto leading-[1.1]">
          Software creation engineered for <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-accent-cyan">craftsmen</span>.
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-gray-400 max-w-3xl mx-auto leading-relaxed">
          CoderXP is a developer-first AI software engineering workspace being built around verifiable execution, flexible model access, and transparent workflows.
        </p>

        {/* Call To Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <Link
            href="/workspace"
            className="px-6 py-3.5 rounded-xl bg-accent-cyan text-obsidian-deep font-semibold text-sm hover:bg-accent-cyan/90 transition-all flex items-center gap-2 shadow-lg shadow-accent-cyan/20"
          >
            Explore Workspace Architecture
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/bring-your-own-key"
            className="px-6 py-3.5 rounded-xl bg-obsidian-card border border-titanium-border text-gray-200 font-semibold text-sm hover:bg-obsidian-hover hover:border-titanium-bright transition-all flex items-center gap-2"
          >
            <Key className="w-4 h-4 text-accent-cyan" />
            Explore BYOK Model
          </Link>
        </div>

        {/* Cinematic Product Story Video Container */}
        <div className="pt-8 max-w-5xl mx-auto">
          <HeroVideo />
        </div>

      </section>

      {/* MODEL SUPPORT TICKER */}
      <section className="border-y border-titanium-border/80 bg-obsidian-card/60 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-4">
          <p className="text-xs uppercase tracking-widest font-mono text-gray-500">
            Planned Frontier & Local AI Model Integrations
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2">
            {[
              { name: "Claude 3.5 Sonnet", type: "Anthropic (Planned)" },
              { name: "GPT-4o / o3-mini", type: "OpenAI (Planned)" },
              { name: "Gemini 2.0 Flash", type: "Google (Planned)" },
              { name: "DeepSeek V3 / R1", type: "DeepSeek (Planned)" },
              { name: "Codestral", type: "Mistral (Planned)" },
              { name: "Ollama / LM Studio", type: "Local LLM Bridge" }
            ].map((m) => (
              <div key={m.name} className="p-3 rounded-lg bg-obsidian-deep border border-titanium-border text-left">
                <p className="text-xs font-medium text-white">{m.name}</p>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">{m.type}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CORE FEATURES GRID */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center space-y-3">
          <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
            Engineered for serious software development
          </h2>
          <p className="text-sm text-gray-400 max-w-2xl mx-auto">
            Architectural vision and planned core capabilities of the CoderXP workspace platform.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1 */}
          <div className="p-6 rounded-xl glass-panel space-y-4">
            <div className="w-10 h-10 rounded-lg bg-obsidian-deep border border-titanium-border flex items-center justify-center text-accent-cyan">
              <Terminal className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Real Terminal Execution</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Planned execution architecture displaying real stdout and stderr streams directly from isolated execution containers.
            </p>
            <div className="pt-2 text-[11px] font-mono text-gray-400 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent-cyan" /> Planned Infrastructure
            </div>
          </div>

          {/* Card 2 */}
          <div className="p-6 rounded-xl glass-panel space-y-4">
            <div className="w-10 h-10 rounded-lg bg-obsidian-deep border border-titanium-border flex items-center justify-center text-accent-cyan">
              <Key className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Bring Your Own Keys (BYOK)</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Planned BYOK vault allowing developers to connect API keys for OpenAI, Anthropic, Gemini, and DeepSeek at raw cost.
            </p>
            <div className="pt-2 text-[11px] font-mono text-gray-400 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-accent-cyan" /> Planned AES-256 Vault
            </div>
          </div>

          {/* Card 3 */}
          <div className="p-6 rounded-xl glass-panel space-y-4">
            <div className="w-10 h-10 rounded-lg bg-obsidian-deep border border-titanium-border flex items-center justify-center text-accent-cyan">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold text-white">Local Model Bridge</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Technical proposal for bridging local LLM instances (Ollama, LM Studio) to hosted web interfaces safely.
            </p>
            <div className="pt-2 text-[11px] font-mono text-gray-400 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-accent-amber" /> Technical Proposal
            </div>
          </div>

        </div>
      </section>

      {/* WHY CODERXP COMPARISON */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="p-8 sm:p-12 rounded-2xl glass-panel-elevated space-y-8">
          <div className="text-center space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">Why CoderXP is different</h2>
            <p className="text-sm text-gray-400">Comparing traditional AI builders with CoderXP engineering standards.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
            
            {/* Generic AI Coders */}
            <div className="p-6 rounded-xl bg-obsidian-deep/80 border border-red-900/30 space-y-3">
              <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                Generic AI Builders
              </h3>
              <ul className="space-y-2 text-xs text-gray-400 font-mono">
                <li className="flex items-center gap-2">✕ Simulated fake typing animations</li>
                <li className="flex items-center gap-2">✕ Forced monthly API token markups</li>
                <li className="flex items-center gap-2">✕ Cliché purple/magenta glow themes</li>
                <li className="flex items-center gap-2">✕ Single-provider vendor lock-in</li>
              </ul>
            </div>

            {/* CoderXP Standards */}
            <div className="p-6 rounded-xl bg-obsidian-deep/80 border border-emerald-800/40 space-y-3">
              <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                CoderXP Planned Standards
              </h3>
              <ul className="space-y-2 text-xs text-gray-200 font-mono">
                <li className="flex items-center gap-2">✓ Real terminal stdout/stderr stream execution</li>
                <li className="flex items-center gap-2">✓ BYOK First (OpenAI, Anthropic, Gemini, DeepSeek, Local)</li>
                <li className="flex items-center gap-2">✓ Obsidian titanium developer-first aesthetic</li>
                <li className="flex items-center gap-2">✓ Open standards & exportable repositories</li>
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* BUILT FOR USER ROLES (AUTHENTIC TESTIMONIAL CAROUSEL) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-white">Engineered for your workflow</h2>
          <p className="text-xs text-gray-400">Target engineering personas and use cases.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              role: "Indie Founders & Solo Devs",
              desc: "Ship full-stack products using BYOK keys without paying high monthly token subscription overheads.",
              highlight: "BYOK & Speed"
            },
            {
              role: "Senior Software Engineers",
              desc: "Inspect real AST diffs, terminal outputs, and dependency trees rather than guessing what AI generated.",
              highlight: "Real Execution"
            },
            {
              role: "Privacy-Conscious Teams",
              desc: "Run local Ollama or LM Studio models via direct local bridge for zero-telemetry internal code generation.",
              highlight: "Local LLM Bridge"
            }
          ].map((item) => (
            <div key={item.role} className="p-6 rounded-xl glass-panel space-y-3">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20">
                {item.highlight}
              </span>
              <h3 className="text-sm font-semibold text-white">{item.role}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CALL TO ACTION */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
        <div className="p-10 rounded-2xl glass-panel-elevated space-y-6 border border-titanium-bright/40">
          <h2 className="text-3xl font-bold text-white tracking-tight">
            Explore the CoderXP Vision & Roadmap
          </h2>
          <p className="text-sm text-gray-400 max-w-xl mx-auto">
            Review the standalone product routes and visual architecture for Milestone 1.
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/workspace"
              className="px-6 py-3.5 rounded-xl bg-accent-cyan text-obsidian-deep font-semibold text-sm hover:bg-accent-cyan/90 transition-all flex items-center gap-2"
            >
              Explore Workspace Overview
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
