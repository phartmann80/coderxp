import type { Metadata } from "next";
import { MessageSquare, Github, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact & Support | CoderXP",
  description:
    "Get in touch with the CoderXP engineering team for support, enterprise inquiries, and feedback.",
  alternates: {
    canonical: "/contact",
  },
};

export default function ContactPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 md:py-16 space-y-12">
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <span className="text-xs font-mono text-accent-cyan uppercase tracking-widest px-2.5 py-1 rounded bg-accent-cyan/10 border border-accent-cyan/20">
          Get in Touch
        </span>
        <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
          Contact & Community
        </h1>
        <p className="text-sm sm:text-base text-gray-400">
          Have questions, feedback, or want to contribute to the CoderXP engineering roadmap?
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl glass-panel space-y-4">
          <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center text-accent-cyan">
            <Github className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-white">GitHub Discussions & Issues</h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            Report bugs, request model integrations, or discuss architecture specifications with the core maintainers.
          </p>
          <a
            href="https://github.com/phartmann80/coderxp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs font-mono text-accent-cyan hover:underline"
          >
            Visit Repository <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="p-6 rounded-xl glass-panel space-y-4">
          <div className="w-10 h-10 rounded-lg bg-accent-emerald/10 border border-accent-emerald/20 flex items-center justify-center text-accent-emerald">
            <MessageSquare className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-semibold text-white">Direct Engineering Contact</h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            For security disclosures, enterprise licensing inquiries, or direct feedback, reach out to our team.
          </p>
          <a
            href="mailto:contact@coderxp.pro"
            className="inline-flex items-center gap-2 text-xs font-mono text-accent-emerald hover:underline"
          >
            contact@coderxp.pro <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
