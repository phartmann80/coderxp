import type { Metadata } from "next";
import "./globals.css";
import { GlobalHeader } from "@/components/navigation/GlobalHeader";
import { EnterpriseFooter } from "@/components/navigation/EnterpriseFooter";

export const metadata: Metadata = {
  title: "CoderXP | The Signature AI Software Engineering Workspace",
  description: "Handcrafted, ultra-premium AI software engineering workspace built for developers, founders, and teams. Real execution engine, bring-your-own-keys, and local LLM bridge.",
  keywords: ["AI Software Engineer", "BYOK AI", "Real Code Execution", "Developer OS", "Local LLMs", "Next.js AI Workspace"],
  authors: [{ name: "CoderXP Team" }],
  openGraph: {
    title: "CoderXP | The Signature AI Software Engineering Workspace",
    description: "Handcrafted, ultra-premium AI software engineering workspace built for developers, founders, and teams.",
    url: "https://coderxp.app",
    siteName: "CoderXP",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-obsidian text-gray-100 min-h-screen flex flex-col antialiased selection:bg-accent-cyan/30 selection:text-white">
        <GlobalHeader />
        <main className="flex-1 flex flex-col">{children}</main>
        <EnterpriseFooter />
      </body>
    </html>
  );
}
