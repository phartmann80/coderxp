import type { Metadata } from "next";
import "./globals.css";
import { GlobalHeader } from "@/components/navigation/GlobalHeader";
import { EnterpriseFooter } from "@/components/navigation/EnterpriseFooter";

export const metadata: Metadata = {
  title: "CoderXP | The Signature AI Software Engineering Workspace",
  description: "AI software engineering workspace in development, built for developers, founders, and teams. Bring-your-own-keys, local LLM bridge, and real execution engine on the roadmap.",
  keywords: ["AI Software Engineer", "BYOK AI", "Developer OS", "Local LLMs", "Next.js AI Workspace"],
  authors: [{ name: "CoderXP Team" }],
  openGraph: {
    title: "CoderXP | The Signature AI Software Engineering Workspace",
    description: "Handcrafted, ultra-premium AI software engineering workspace built for developers, founders, and teams.",
    url: "https://coderxp.pro",
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
