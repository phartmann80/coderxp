import Link from "next/link";
import Image from "next/image";
import { Github, ArrowUpRight } from "lucide-react";

export function EnterpriseFooter() {
  return (
    <footer className="border-t border-titanium-border bg-obsidian-deep text-gray-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        
        {/* Main Footer Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12 mb-12">
          
          {/* Brand Column */}
          <div className="col-span-2 space-y-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-obsidian-card border border-titanium-border">
                <Image src="/logo.png" alt="CoderXP" width={24} height={24} className="object-contain" />
              </div>
              <span className="font-semibold text-white text-base tracking-tight">
                Coder<span className="text-accent-cyan">XP</span>
              </span>
            </Link>
            <p className="text-gray-400 max-w-sm text-xs leading-relaxed">
              A developer-first AI software engineering workspace being built around verifiable execution, flexible model access, and transparent workflows.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono bg-obsidian-card border border-titanium-border text-gray-400">
                Milestone 1 Visual Candidate (Private Preview)
              </span>
            </div>
          </div>

          {/* Column 1: Product */}
          <div className="space-y-3">
            <h4 className="text-white text-xs font-semibold uppercase tracking-wider font-mono">Product</h4>
            <ul className="space-y-2">
              <li><Link href="/features" className="hover:text-white transition-colors">Features</Link></li>
              <li><Link href="/workspace" className="hover:text-white transition-colors">Workspace</Link></li>
              <li><Link href="/models" className="hover:text-white transition-colors">Supported Models</Link></li>
              <li><Link href="/bring-your-own-key" className="hover:text-white transition-colors">Bring Your Own Key</Link></li>
              <li><Link href="/local-models" className="hover:text-white transition-colors">Local Model Bridge</Link></li>
              <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing & Plans</Link></li>
            </ul>
          </div>

          {/* Column 2: Ecosystem & Developer */}
          <div className="space-y-3">
            <h4 className="text-white text-xs font-semibold uppercase tracking-wider font-mono">Developers</h4>
            <ul className="space-y-2">
              <li><Link href="/docs" className="hover:text-white transition-colors">Documentation</Link></li>
              <li><Link href="/api" className="hover:text-white transition-colors">API Specifications</Link></li>
              <li><Link href="/security" className="hover:text-white transition-colors">Security Architecture</Link></li>
              <li>
                <a href="https://github.com/phartmann80/coderxp" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white transition-colors">
                  GitHub Repository <ArrowUpRight className="w-3 h-3 text-gray-500" />
                </a>
              </li>
              <li><Link href="/contact" className="hover:text-white transition-colors">Developer Support</Link></li>
            </ul>
          </div>

          {/* Column 3: Legal & Governance */}
          <div className="space-y-3">
            <h4 className="text-white text-xs font-semibold uppercase tracking-wider font-mono">Governance</h4>
            <ul className="space-y-2">
              <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link href="/cookies" className="hover:text-white transition-colors">Cookie Policy</Link></li>
              <li><Link href="/about" className="hover:text-white transition-colors">About CoderXP</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom Disclaimer & Copyright */}
        <div className="pt-8 border-t border-titanium-border/60 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[11px] text-gray-500">
            &copy; 2026 CoderXP. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-gray-400">
            <a href="https://github.com/phartmann80/coderxp" target="_blank" rel="noreferrer" aria-label="GitHub Repository" className="hover:text-white transition-colors flex items-center gap-1 text-xs">
              <Github className="w-4 h-4" /> GitHub
            </a>
          </div>
        </div>

      </div>
    </footer>
  );
}
