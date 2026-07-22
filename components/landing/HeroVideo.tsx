"use me";
"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Play, Shield, Terminal, Cpu, CheckCircle } from "lucide-react";

interface HeroVideoProps {
  desktopSrc?: string;
  mobileSrc?: string;
  posterSrc?: string;
}

export function HeroVideo({
  desktopSrc = "/video/coderxp-hero-desktop.mp4",
  mobileSrc = "/video/coderxp-hero-mobile.mp4",
  posterSrc = "/images/coderxp-hero-poster.webp",
}: HeroVideoProps) {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Check for reduced motion media query
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return (
    <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-titanium-border bg-obsidian-card glass-panel titanium-border-glow shadow-2xl">
      
      {/* Video element */}
      {!prefersReducedMotion && !videoError && (
        <video
          ref={videoRef}
          className={`w-full h-full object-cover transition-opacity duration-700 ${
            videoLoaded ? "opacity-100" : "opacity-0"
          }`}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={posterSrc}
          onLoadedData={() => setVideoLoaded(true)}
          onError={() => setVideoError(true)}
        >
          <source src={desktopSrc} type="video/mp4" media="(min-width: 768px)" />
          <source src={mobileSrc} type="video/mp4" />
        </video>
      )}

      {/* Fallback Motion Layer & UI Showcase Shell (active if video is loading or fallback mode) */}
      {(!videoLoaded || videoError || prefersReducedMotion) && (
        <div className="absolute inset-0 bg-gradient-to-br from-obsidian-card via-obsidian-elevated to-obsidian-deep flex flex-col justify-between p-4 sm:p-6 font-mono text-xs overflow-hidden">
          
          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-titanium-border pb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              <span className="text-gray-400 text-[11px] ml-2">coderxp-workspace-v1.0.0</span>
            </div>
            <div className="flex items-center gap-3 text-gray-500 text-[11px]">
              <span className="flex items-center gap-1 text-accent-emerald font-semibold">
                <CheckCircle className="w-3 h-3" /> Real Execution Engine
              </span>
              <span className="flex items-center gap-1 text-accent-cyan">
                <Cpu className="w-3 h-3" /> BYOK Active
              </span>
            </div>
          </div>

          {/* Interactive Workspace Motion Preview Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-auto">
            
            {/* Context & Prompt Panel */}
            <div className="p-3.5 rounded-lg bg-obsidian-deep/90 border border-titanium-border space-y-2">
              <div className="text-accent-cyan flex items-center gap-1.5 text-[11px] font-semibold">
                <Terminal className="w-3.5 h-3.5" /> 1. Input & Architecture
              </div>
              <p className="text-gray-300 text-[11px]">
                Build a SaaS application with Next.js 14, real-time Supabase auth, and direct local Ollama integration.
              </p>
              <div className="pt-2 flex items-center gap-1 text-[10px] text-gray-500">
                <span className="px-1.5 py-0.5 rounded bg-titanium-border/60 text-gray-300">Claude 3.5 Sonnet</span>
                <span className="px-1.5 py-0.5 rounded bg-titanium-border/60 text-gray-300">BYOK</span>
              </div>
            </div>

            {/* Live Terminal & AST Diff */}
            <div className="p-3.5 rounded-lg bg-obsidian-deep/90 border border-titanium-border space-y-2">
              <div className="text-accent-emerald flex items-center gap-1.5 text-[11px] font-semibold">
                <Shield className="w-3.5 h-3.5" /> 2. Real Execution Terminal
              </div>
              <div className="text-[10px] text-gray-400 space-y-1 font-mono">
                <p className="text-gray-500">$ pnpm install @supabase/ssr lucide-react</p>
                <p className="text-emerald-400">✓ Resolved dependencies (142 packages)</p>
                <p className="text-cyan-400">✓ AST diff created: app/page.tsx</p>
              </div>
            </div>

            {/* Interactive Live Preview */}
            <div className="p-3.5 rounded-lg bg-obsidian-deep/90 border border-titanium-border space-y-2">
              <div className="text-gray-300 flex items-center justify-between text-[11px] font-semibold">
                <span>3. Live Preview Runner</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400">Interactive</span>
              </div>
              <div className="h-16 rounded bg-obsidian-card border border-titanium-border/60 flex items-center justify-center text-gray-500 text-[10px]">
                Preview Runner Isolated iFrame Sandbox
              </div>
            </div>

          </div>

          {/* Bottom Bar */}
          <div className="flex items-center justify-between pt-3 border-t border-titanium-border/60 text-[10px] text-gray-500">
            <span>Story Sequence: Idea → Understanding → Planning → Code → Execution → Verification → Live Preview</span>
            <span className="font-mono text-accent-cyan">CoderXP Engine Verified</span>
          </div>

        </div>
      )}

      {/* Subtle overlay vignette */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-obsidian-deep/40 via-transparent to-transparent" />
    </div>
  );
}
