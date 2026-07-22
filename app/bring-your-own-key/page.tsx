import { Key, ShieldCheck, Lock, Server, Zap, RefreshCw, Info } from "lucide-react";

export default function ByokPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 md:py-16 space-y-12">
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <span className="text-xs font-mono text-accent-cyan uppercase tracking-widest px-2.5 py-1 rounded bg-accent-cyan/10 border border-accent-cyan/20">
          Primary Philosophy & Architecture
        </span>
        <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
          Bring Your Own Keys (BYOK)
        </h1>
        <p className="text-sm sm:text-base text-gray-400">
          CoderXP is designed around direct provider API credentials so developers pay providers directly at raw cost.
        </p>
      </div>

      <div className="p-4 rounded-xl bg-obsidian-card border border-titanium-border flex items-start gap-3 text-xs text-gray-300">
        <Info className="w-5 h-5 text-accent-cyan shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white font-mono uppercase tracking-wider block">Capability Status: Planned (Milestone 3)</span>
          The BYOK security vault and key rotation engine below represent our planned technical architecture. Production key storage will be implemented and verified in Milestone 3.
        </div>
      </div>

      <div className="glass-panel p-8 rounded-2xl space-y-8">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-accent-cyan" /> AES-256-GCM Server Encryption Model (Planned)
          </h2>
          <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
            API credentials in the planned BYOK vault will be encrypted at rest using server-side AES-256-GCM before database storage. Raw API keys will never be stored in plaintext browser storage or telemetry logs.
          </p>
        </div>

        <div className="border-t border-titanium-border/60 pt-6 space-y-3">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-accent-emerald" /> Rotation & Scope Governance (Planned)
          </h2>
          <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
            The planned key manager will allow developers to rotate keys, test latency, and isolate credentials per project scope.
          </p>
        </div>
      </div>
    </div>
  );
}
